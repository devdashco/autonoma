import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { type AgentResult, buildDefaultStepLogger, formatRetryGuidance, runAgent } from "../../core/agent";
import { formatContext, type ProjectContext } from "../../core/context";
import { debugLog } from "../../core/debug";
import { getModel } from "../../core/model";
import { pickString } from "../../core/pick-string";
import { reviewLoop } from "../../core/review";
import type { buildReadFileTool } from "../../tools";
import { buildCodebaseTools } from "../../tools";
import { parseCoreFlows, renderFlowsTable } from "./flows";
import { SYSTEM_PROMPT } from "./prompt";

export interface KBGeneratorInput {
    projectRoot: string;
    outputDir: string;
    modelId?: string;
    projectContext?: ProjectContext;
    nonInteractive?: boolean;
    retryGuidance?: string;
}

class PageTracker {
    registered = new Set<string>();
    read = new Set<string>();

    register(pages: string[]) {
        for (const p of pages) this.registered.add(p);
    }

    markRead(filePath: string) {
        if (this.registered.has(filePath)) {
            this.read.add(filePath);
        }
    }

    unread(): string[] {
        return [...this.registered].filter((p) => !this.read.has(p));
    }

    coverage(): { total: number; read: number; unread: string[] } {
        return {
            total: this.registered.size,
            read: this.read.size,
            unread: this.unread(),
        };
    }
}

function buildRegisterPagesTool(tracker: PageTracker) {
    return tool({
        description:
            "Register ALL page/route files discovered via glob. " +
            "Call this ONCE after globbing for page files. " +
            "The system will track which ones you've read and block finish until all are covered.",
        inputSchema: z.object({
            pages: z.array(z.string()).describe("All page file paths found by glob"),
        }),
        execute: async (input) => {
            tracker.register(input.pages);
            return {
                registered: input.pages.length,
                message: `Registered ${input.pages.length} pages. You must read_file each one before calling finish.`,
            };
        },
    });
}

function buildPageCoverageTool(tracker: PageTracker) {
    return tool({
        description: "Check how many registered pages you've read vs how many remain.",
        inputSchema: z.object({}),
        execute: async () => tracker.coverage(),
    });
}

function buildFinishTool(tracker: PageTracker, onFinish: (result: AgentResult) => void) {
    return tool({
        description:
            "Call when you have finished generating the knowledge base. " +
            "BLOCKED if there are unread pages - call page_coverage first to check.",
        inputSchema: z.object({
            summary: z.string().describe("Summary of what was generated"),
            artifacts: z.array(z.string()).describe("List of files written"),
        }),
        execute: async (input) => {
            const cov = tracker.coverage();
            if (cov.unread.length > 0) {
                return {
                    error: `Cannot finish: ${cov.unread.length}/${cov.total} pages not yet read. Read these files first:\n${cov.unread.join("\n")}`,
                };
            }
            onFinish({
                success: true,
                artifacts: input.artifacts,
                summary: input.summary,
            });
            return { success: true };
        },
    });
}

function buildTrackedReadTool(tracker: PageTracker, baseTool: ReturnType<typeof buildReadFileTool>) {
    return tool({
        description: baseTool.description,
        inputSchema: baseTool.inputSchema,
        execute: async (input, options) => {
            const filePath = pickString(input, ["filePath", "path", "file_path"]) ?? "";
            tracker.markRead(filePath);
            return baseTool.execute!(input, options);
        },
    });
}

export async function runKBGenerator(input: KBGeneratorInput): Promise<AgentResult> {
    const model = getModel(input.modelId);

    let result: AgentResult | undefined;
    const tracker = new PageTracker();

    const { logger, onStepFinish } = buildDefaultStepLogger("kb", 150);

    const contextBlock =
        (input.projectContext ? "\n" + formatContext(input.projectContext) + "\n" : "") +
        formatRetryGuidance(input.retryGuidance);

    const pages = input.projectContext?.pages;
    if (pages?.length) {
        tracker.register(pages.map((p) => p.path));
    }

    const prompt = pages?.length
        ? `Analyze the codebase at the working directory and generate a complete knowledge base.
${contextBlock}
MANDATORY PROCESS:
Pages have already been discovered (${pages.length} routes pre-registered). You do NOT need to glob for them.
1. Use list_directory at root to understand the project structure
2. Read EVERY registered page file with read_file - the system tracks this
3. Write AUTONOMA.md progressively as you go (update it after each major area)
4. Call page_coverage to verify you've read all pages
5. Call finish - it will REJECT if pages are unread

Output files:
1. AUTONOMA.md - with YAML frontmatter (app_name, app_description, core_flows, feature_count)`
        : `Analyze the codebase at the working directory and generate a complete knowledge base.
${contextBlock}
MANDATORY PROCESS:
1. Use list_directory at root to understand the project structure
2. Use glob to find ALL page/route files (e.g. '**/page.tsx', '**/page.ts')
3. Call register_pages with the FULL list of page files from glob
4. Read EVERY registered page file with read_file - the system tracks this
5. Write AUTONOMA.md progressively as you go (update it after each major area)
6. Call page_coverage to verify you've read all pages
7. Call finish - it will REJECT if pages are unread

Output files:
1. AUTONOMA.md - with YAML frontmatter (app_name, app_description, core_flows, feature_count)`;

    const agentConfig = {
        id: "kb-generator",
        systemPrompt: SYSTEM_PROMPT,
        model,
        maxSteps: 150,
        tools: async (heartbeat: () => void) => {
            const onFileRead = (path: string) => tracker.markRead(path);
            const tools = await buildCodebaseTools(model, input.projectRoot, input.outputDir, heartbeat, onFileRead);
            return {
                ...tools,
                read_file: buildTrackedReadTool(tracker, tools.read_file),
                register_pages: buildRegisterPagesTool(tracker),
                page_coverage: buildPageCoverageTool(tracker),
                finish: buildFinishTool(tracker, (r) => {
                    result = r;
                }),
            };
        },
        onStepFinish,
    };

    await runAgent(agentConfig, prompt, () => result);
    logger.summary();

    // The finish tool can be blocked (e.g. by the page-coverage gate) even though
    // the agent already wrote AUTONOMA.md - which would leave `result` undefined
    // and silently skip the whole review. Don't let that happen: if the file
    // exists, treat the step as done so the user still gets the flows table, the
    // file path, and the editor/chat review below.
    const autonomaPath = join(input.outputDir, "AUTONOMA.md");
    const autonomaExists = await readFile(autonomaPath, "utf-8")
        .then(() => true)
        .catch((err) => {
            debugLog("AUTONOMA.md not found while checking step completion", { err });
            return false;
        });
    if (!result?.success && autonomaExists) {
        result = {
            success: true,
            artifacts: ["AUTONOMA.md"],
            summary: "Knowledge base generated.",
        };
    }

    // Self-review pass: before involving the user, make the agent verify that the
    // flows the user explicitly declared critical actually landed in core_flows as
    // core: true - and fix the file if not. Targets "a starting input was ignored".
    const declaredCriticalFlows = input.projectContext?.criticalFlows?.trim();
    if (result?.success && declaredCriticalFlows) {
        const beforeSelfReview = result;
        result = undefined;
        const selfReviewPrompt = `Before this knowledge base is shown to the user, verify it honors the critical flows they explicitly declared.

The user said these flows are critical and cannot break:
"${declaredCriticalFlows}"

Read your AUTONOMA.md output. For EACH critical flow the user named:
- Confirm it appears as a feature in core_flows (map the user's wording to the matching feature).
- Confirm that feature is marked core: true with a coreReason.

If any declared critical flow is missing, mismatched, or left core: false, FIX AUTONOMA.md now - add the feature if it is genuinely absent, or flip core to true with a coreReason. Do not downgrade or drop anything the user declared critical.

When AUTONOMA.md correctly reflects every declared critical flow, call finish.`;
        await runAgent(agentConfig, selfReviewPrompt, () => result);
        // If the agent didn't re-call finish (e.g. no changes needed), keep the prior result.
        if (!result) result = beforeSelfReview;
    }

    const reviewed = await reviewLoop(result, {
        agentId: "kb-generator",
        outputDir: input.outputDir,
        nonInteractive: input.nonInteractive,
        renderSummary: async () => {
            const flows = await parseCoreFlows(input.outputDir);
            return flows.length ? renderFlowsTable(flows) : undefined;
        },
        reviewGuidance:
            "Check that every page/route in your app appears in core_flows.\n" +
            "Verify that every flow the user named as critical in the Project Context appears in core_flows and is marked core: true with a coreReason.\n" +
            "Verify the mission for each feature describes the ONE thing it must do correctly.\n" +
            "Look for missing features or incorrectly grouped pages.\n" +
            "A complex app should have 20-40 features - if you see fewer than 15, features are probably grouped too aggressively.",
        onFeedback: async (feedback) => {
            result = undefined;
            const feedbackPrompt = `The user reviewed your knowledge base output and has this feedback:

"${feedback}"

Read your previous output file (AUTONOMA.md) from the output directory to see what you produced.
Adjust based on the feedback. You can read source files again if needed.
Call page_coverage to see current state. When done with changes, call finish again.`;

            await runAgent(agentConfig, feedbackPrompt, () => result);
            return result;
        },
    });

    return (
        reviewed ?? {
            success: false,
            artifacts: [],
            summary: "KB generator agent stopped without producing AUTONOMA.md",
        }
    );
}
