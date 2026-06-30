import * as p from "@clack/prompts";
import { tool } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { runAgent, buildDefaultStepLogger } from "../../../core/agent";
import { formatException } from "../../../core/errors";
import { codeNoteFormat } from "../../../core/highlight";
import { notify } from "../../../core/notify";
import { toRecord } from "../../../core/to-record";
import { buildReadFileTool } from "../../../tools";
import {
    fetchDiscoverSchema,
    renderModelSchema,
    validateRecipeAgainstSchema,
    formatValidationProblems,
} from "../discover-schema";
import type { AuditedModel } from "../entity-order";
import * as sdk from "../http-client";
import type { SdkClientConfig } from "../http-client";
import { buildFullRecipe, type RecipePayload } from "../recipe";
import type { RecipeBuilderState } from "../state";
import { saveRecipeState } from "../state";

/**
 * Revise the entire recipe based on user feedback after they reviewed the app.
 * Unlike the per-entity revise, this agent sees the whole recipe so it can fix
 * issues that span entities (e.g. cross-references between records).
 */
async function reviseFullRecipe(
    current: RecipePayload,
    feedback: string,
    model: LanguageModel,
    outputDir: string,
    entityOrder: string[],
    schemaSpec?: string,
): Promise<RecipePayload | undefined> {
    let revised: RecipePayload | undefined;

    const finishTool = tool({
        description: "Submit the revised full recipe: an object mapping each entity name to its array of records.",
        inputSchema: z.object({
            recipe: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
        }),
        execute: async (input) => {
            revised = input.recipe;
            return { done: true };
        },
    });

    const { logger, onStepFinish } = buildDefaultStepLogger("revise:full-recipe", 20);

    await runAgent(
        {
            id: "revise-full-recipe",
            systemPrompt: `You are revising a full test-data recipe based on user feedback after they reviewed the app populated with this data.

The recipe is an object mapping entity names to arrays of records. Records use:
- _alias: a unique id for a record so other records can point to it
- _ref: { "_ref": "alias" } points to a parent record's _alias

Rules:
- Apply the user's feedback across whatever entities it touches.
- Keep _ref values pointing to aliases that actually exist in the recipe. Never invent a _ref to a missing alias.
- Entities are created in this order (parents first): ${entityOrder.join(" → ")}. A record may only _ref an alias declared by an entity earlier in that order.
- Field names, types, and required fields must match the live schema below when present (it is the source of truth), otherwise the schema in entity-audit.md.
- Read scenarios.md and entity-audit.md from the output directory as needed.
${schemaSpec ? `\n${schemaSpec}\n` : ""}
Return the COMPLETE revised recipe (all entities, not just the changed ones) via finish.`,
            model,
            maxSteps: 20,
            tools: (_heartbeat: () => void) => ({
                read_output: buildReadFileTool(outputDir),
                finish: finishTool,
            }),
            onStepFinish,
        },
        `The user reviewed the app with this test data and said it doesn't look right.

Current full recipe:
${JSON.stringify(current, null, 2)}

User feedback:
"${feedback}"

Revise the recipe to address the feedback, then call finish with the complete updated recipe.`,
        () => revised,
    );
    logger.summary();

    return revised;
}

async function teardown(
    sdkConfig: SdkClientConfig,
    refsToken: string | undefined,
    successMessage: string,
): Promise<boolean> {
    if (!refsToken) return true;

    p.log.step("[Full validation] Tearing down all entities...");
    let downResult: Awaited<ReturnType<typeof sdk.down>>;
    try {
        downResult = await sdk.down(sdkConfig, refsToken);
    } catch (err) {
        p.log.error(`Full DOWN request failed:\n${formatException(err)}`);
        return false;
    }
    if (!downResult.ok) {
        p.log.error(`Full DOWN failed (HTTP ${downResult.status}):`);
        console.log(JSON.stringify(downResult.body, null, 2));
        return false;
    }
    p.log.success(successMessage);
    return true;
}

export async function runFullValidation(
    state: RecipeBuilderState,
    _models: AuditedModel[],
    outputDir: string,
    model: LanguageModel,
): Promise<boolean> {
    const total = state.entityOrder.length;

    p.log.info(
        `All individual factories work. Now let's create EVERYTHING together and verify the app looks right with a full dataset. This is the recipe that will run before every test execution.`,
    );

    if (!state.sdkEndpointUrl) {
        const url = await p.text({
            message: "What's your SDK endpoint URL?",
            placeholder: "http://localhost:3000/api/autonoma",
            defaultValue: "http://localhost:3000/api/autonoma",
        });
        if (p.isCancel(url)) throw new Error("Cancelled");
        state.sdkEndpointUrl = url.trim() || "http://localhost:3000/api/autonoma";
        await saveRecipeState(outputDir, state);
    }

    const sdkConfig: SdkClientConfig = {
        endpointUrl: state.sdkEndpointUrl,
        sharedSecret: state.sharedSecret ?? "",
    };

    // By this phase every factory is registered, so /discover returns the full
    // schema. Use it to ground revisions and to flag schema violations up front.
    const discoverSchema = await fetchDiscoverSchema(sdkConfig);
    const fullSchemaSpec = discoverSchema
        ? state.entityOrder
              .map((name) => renderModelSchema(discoverSchema, name))
              .filter(Boolean)
              .join("\n\n") || undefined
        : undefined;

    let fullRecipe = buildFullRecipe(state.entityOrder, state.entities);

    // UP → review → (teardown) → approve or revise-and-retry loop
    while (true) {
        if (discoverSchema) {
            const problems = validateRecipeAgainstSchema(fullRecipe, discoverSchema);
            if (problems.length > 0) {
                p.log.warn(
                    `Heads up - the recipe has likely schema problems (from /discover); the full UP may fail:\n${formatValidationProblems(problems)}`,
                );
            }
        }

        const testRunId = `full-${Date.now()}`;
        p.log.step(`[Full validation] Creating all ${total} entities...`);

        let upResult: Awaited<ReturnType<typeof sdk.up>>;
        try {
            upResult = await sdk.up(sdkConfig, fullRecipe, testRunId);
        } catch (err) {
            p.log.error(`Full UP request failed:\n${formatException(err)}`);
            notify("Autonoma", "Full validation UP failed, action needed");
            const action = await p.select({
                message: "What would you like to do?",
                options: [
                    { value: "retry", label: "Yes, retry - I fixed it", hint: "Send the request again" },
                    { value: "skip", label: "No, skip full validation", hint: "Continue to test generation" },
                ],
            });
            if (p.isCancel(action)) throw new Error("Cancelled");
            if (action === "skip") return false;
            continue;
        }

        if (!upResult.ok) {
            p.log.error(`Full UP failed (HTTP ${upResult.status}):`);
            console.log(JSON.stringify(upResult.body, null, 2));
            notify("Autonoma", "Full validation UP failed, action needed");
            const action = await p.select({
                message: "What would you like to do?",
                options: [
                    { value: "retry", label: "Yes, retry - I fixed it", hint: "Send the request again" },
                    { value: "skip", label: "No, skip full validation", hint: "Continue to test generation" },
                ],
            });
            if (p.isCancel(action)) throw new Error("Cancelled");
            if (action === "skip") return false;
            continue;
        }

        p.log.success("Full UP succeeded!");
        const body = toRecord(upResult.body);
        const refsToken = typeof body.refsToken === "string" ? body.refsToken : undefined;

        const auth = body.auth != null && typeof body.auth === "object" ? toRecord(body.auth) : undefined;
        if (auth && Object.keys(auth).length > 0) {
            const authJson = JSON.stringify(auth, null, 2);
            const looksPlaceholder =
                authJson.includes("test-token") || authJson.includes("placeholder") || authJson.includes("todo");

            p.note(
                authJson +
                    "\n\n" +
                    "These are the credentials your auth callback returns.\n" +
                    "The test runner will use them to authenticate as the test user when executing tests." +
                    (looksPlaceholder
                        ? "\n\n⚠ This looks like a placeholder. Update your auth callback to return real credentials\n" +
                          "(a valid JWT, session cookie, or email/password) so the test runner can actually log in."
                        : ""),
                "Auth credentials",
            );
        } else {
            p.log.warn(
                "No auth credentials returned. Your createHandler's auth callback must return credentials " +
                    "the test runner can use to log in (cookies, headers, or email/password). Without it, tests can't authenticate.",
            );
        }

        p.log.info("Browse the app and check if the test data looks right.");

        notify("Autonoma", "Full validation succeeded - review the app");
        const looksGood = await p.confirm({
            message: "Does the app look right with the test data?",
        });
        if (p.isCancel(looksGood)) throw new Error("Cancelled");

        // Always tear down the data we just created before deciding the next step.
        const torndown = await teardown(
            sdkConfig,
            refsToken,
            looksGood
                ? "Full lifecycle works. All data was created and torn down cleanly."
                : "Tore down the test data so we can regenerate it.",
        );
        if (!torndown) return false;

        if (looksGood) return true;

        // Not right: collect feedback, revise the FULL recipe, and retry.
        const feedback = await p.text({
            message: "What's wrong with the test data? Describe what to change.",
            placeholder: "e.g. accounts need realistic balances, transactions should reference the right account...",
        });
        if (p.isCancel(feedback) || !feedback.trim()) {
            p.log.info("No feedback given. You can edit recipe.json manually and re-run with --resume.");
            return false;
        }

        p.log.info("Revising the full recipe based on your feedback...");
        const revised = await reviseFullRecipe(
            fullRecipe,
            feedback.trim(),
            model,
            outputDir,
            state.entityOrder,
            fullSchemaSpec,
        );
        if (!revised) {
            p.log.warn("Couldn't revise automatically. Edit recipe.json manually and re-run with --resume.");
            return false;
        }

        // Persist the revised records back into state, then rebuild and retry.
        for (const [name, records] of Object.entries(revised)) {
            if (state.entities[name]) {
                state.entities[name]!.recipeData = records;
            }
        }
        await saveRecipeState(outputDir, state);
        fullRecipe = buildFullRecipe(state.entityOrder, state.entities);

        p.note(JSON.stringify(fullRecipe, null, 2), "Revised recipe - re-running full validation", {
            format: codeNoteFormat,
        });
    }
}
