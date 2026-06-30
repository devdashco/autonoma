import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import type { AppConfig } from "../../config";
import type { AgentResult } from "../../core/agent";
import type { ProjectContext } from "../../core/context";
import { getModel } from "../../core/model";
import { readEnv } from "../../env";
import { parseEntityAudit, resolveEntityOrder } from "./entity-order";
import { rankEntitiesByImportance } from "./entity-relevance";
import { runEntityLoop } from "./phases/entity-loop";
import { runFullValidation } from "./phases/full-validation";
import { runSubmit } from "./phases/submit";
import { detectTechStack } from "./phases/tech-detect";
import { initialRecipeState, loadRecipeState, saveRecipeState } from "./state";

export interface RecipeBuilderInput {
    projectRoot: string;
    outputDir: string;
    modelId?: string;
    config: AppConfig;
    projectContext?: ProjectContext;
    nonInteractive?: boolean;
    /** User guidance from a pipeline-level retry. The recipe builder has its own
     *  per-entity recovery prompts, so this is accepted but currently unused. */
    retryGuidance?: string;
}

export async function runRecipeBuilder(input: RecipeBuilderInput): Promise<AgentResult> {
    const model = getModel(input.modelId);

    let state = (await loadRecipeState(input.outputDir)) ?? initialRecipeState();

    // Prefer the shared secret provided by onboarding (the application's secret
    // from the dashboard) so the deployment, dashboard, and CLI all sign with the
    // same key. The entity loop only generates a fresh one when none was provided.
    if (state.sharedSecret == null && input.config.sharedSecret != null) {
        state.sharedSecret = input.config.sharedSecret;
        await saveRecipeState(input.outputDir, state);
    }

    const models = await parseEntityAudit(input.outputDir);

    // Phase 1: Tech detection
    if (state.phase === "tech-detect") {
        state.techStack = await detectTechStack(input.projectRoot, input.modelId, input.nonInteractive);

        let importanceRank: Map<string, number> | undefined;
        try {
            const auditMarkdown = await readFile(join(input.outputDir, "entity-audit.md"), "utf-8");
            importanceRank = await rankEntitiesByImportance(models, auditMarkdown, model);
        } catch {
            // Ranking is a UX nicety; on any failure fall back to alphabetical order.
            importanceRank = undefined;
        }

        const entityOrder = resolveEntityOrder(models, importanceRank);
        state.entityOrder = entityOrder;
        state.entities = {};
        for (const name of entityOrder) {
            state.entities[name] = {
                entityName: name,
                status: "pending",
                errorLog: [],
            };
        }

        state.phase = "entity-loop";

        if (input.config.sdkEndpointUrl) {
            state.sdkEndpointUrl = input.config.sdkEndpointUrl;
        }

        await saveRecipeState(input.outputDir, state);
        p.log.info(
            `Found ${entityOrder.length} entities needing factories. Processing core entities first, in dependency order.`,
        );
    }

    // Phase 2: Entity-by-entity loop
    if (state.phase === "entity-loop") {
        await runEntityLoop(state, models, model, input.projectRoot, input.outputDir, input.nonInteractive);

        const allDone = state.entityOrder.every((name) => {
            const e = state.entities[name];
            return e?.status === "tested-down" || e?.status === "skipped";
        });

        if (allDone) {
            state.phase = input.nonInteractive ? "submit" : "full-validation";
            await saveRecipeState(input.outputDir, state);
        } else {
            return {
                success: false,
                paused: true,
                artifacts: [],
                summary: "Paused - run again with --resume to continue from where you left off",
            };
        }
    }

    // Phase 3: Full validation
    if (state.phase === "full-validation") {
        const success = await runFullValidation(state, models, input.outputDir, model);
        if (success) {
            state.phase = "submit";
            await saveRecipeState(input.outputDir, state);
        } else {
            return {
                success: false,
                paused: true,
                artifacts: [],
                summary: "Full validation skipped - run again with --resume to retry",
            };
        }
    }

    // Phase 4: Submit
    if (state.phase === "submit") {
        const env = readEnv();
        const recipePath = await runSubmit(
            state,
            input.outputDir,
            env.AUTONOMA_API_URL,
            env.AUTONOMA_API_TOKEN,
            env.AUTONOMA_GENERATION_ID,
        );

        state.phase = "done";
        await saveRecipeState(input.outputDir, state);

        return {
            success: true,
            artifacts: [recipePath],
            summary: `Recipe builder complete. ${state.entityOrder.length} factories configured.`,
        };
    }

    return {
        success: true,
        artifacts: [],
        summary: "Recipe builder already complete.",
    };
}
