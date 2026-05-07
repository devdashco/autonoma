import { type ModelMessage, tool } from "ai";
import { z } from "zod";
import type { AffectedTest } from "./mark-affected-test-tool";
import type { TestCandidate } from "./suggest-test-tool";

export interface DiffsAgentResult {
    affectedTests: AffectedTest[];
    testCandidates: TestCandidate[];
    reasoning: string;
    /** Full LLM conversation produced by the agent. Captured so it can be persisted for debugging. */
    conversation: ModelMessage[];
}

export type ResultCollector = Omit<DiffsAgentResult, "reasoning" | "conversation">;

/** What the finish tool can produce on its own; the conversation is merged in by the caller. */
export type DiffsAgentFinishOutput = Omit<DiffsAgentResult, "conversation">;

const finishSchema = z.object({
    reasoning: z.string().describe("Overall summary of the analysis: what was found, what actions were taken, and why"),
});

export function buildFinishTool(onFinish: (result: DiffsAgentFinishOutput) => void, collector: ResultCollector) {
    return tool({
        description:
            "Call this tool when you have finished analyzing the diff. " +
            "Provide your overall reasoning and summary. " +
            "All actions (mark_affected_test, suggest_test) " +
            "should have been called BEFORE calling finish.",
        inputSchema: finishSchema,
        execute: ({ reasoning }) => onFinish({ ...collector, reasoning }),
    });
}
