import { Codebase, FlowIndex, HealingAgent, type HealingInput, ScenarioIndex } from "@autonoma/diffs";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";

/**
 * A mock model that finishes immediately by calling `finish`, and records the
 * tool set it was offered on each call. With no failures the `finish` call
 * succeeds on the first step, so the run does exactly one model call - and
 * `doGenerateCalls[0].tools` is the tool set the agent exposed for that turn.
 */
function finishImmediatelyModel(): MockLanguageModelV3 {
    return new MockLanguageModelV3({
        doGenerate: async () => ({
            content: [
                {
                    type: "tool-call",
                    toolCallId: "call-finish",
                    toolName: "finish",
                    input: JSON.stringify({ reasoning: "nothing to do" }),
                },
            ],
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            warnings: [],
        }),
    });
}

/** A minimal, failure-free input for the given turn. */
function turnInput(iteration: number, maxIterations: number): Omit<HealingInput, "codebase"> {
    return {
        iteration,
        maxIterations,
        snapshotId: "snap-1",
        applicationId: "app-1",
        organizationId: "org-1",
        priorActions: [],
        failures: [],
        flowIndex: new FlowIndex([{ id: "all", name: "All Tests", testSlugs: [] }]),
        existingTests: [],
        planAuthoring: { scenarios: new ScenarioIndex([]), flows: [] },
        change: { baseSha: "base", headSha: "head" },
        analysisReasoning: "something changed",
    };
}

/** Run the agent for one turn and return the tool names it offered the model. */
async function toolsOfferedOnTurn(iteration: number, maxIterations: number): Promise<string[]> {
    const model = finishImmediatelyModel();
    const agent = new HealingAgent({ model });
    await agent.run({ ...turnInput(iteration, maxIterations), codebase: new Codebase(process.cwd()) });

    const call = model.doGenerateCalls[0];
    expect(call).toBeDefined();
    return (call?.tools ?? []).map((t) => t.name);
}

describe("HealingAgent final-turn tool gating", () => {
    it("offers the retry tool on a non-final turn", async () => {
        const tools = await toolsOfferedOnTurn(1, 3);

        // Retry tool present...
        expect(tools).toContain("update_plan");
        // ...alongside the terminal tools.
        expect(tools).toContain("report_bug");
        expect(tools).toContain("report_engine_limitation");
        expect(tools).toContain("remove_test");
    });

    it("withholds the retry tool on the final turn, keeping the terminal tools", async () => {
        const tools = await toolsOfferedOnTurn(3, 3);

        // The whole point: no way to author a plan change that would spawn a
        // dangling iteration N+1.
        expect(tools).not.toContain("update_plan");
        // Triage is still fully possible.
        expect(tools).toContain("report_bug");
        expect(tools).toContain("report_engine_limitation");
        expect(tools).toContain("remove_test");
    });
});
