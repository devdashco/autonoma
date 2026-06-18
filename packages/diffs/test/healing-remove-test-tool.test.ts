import { describe, expect, it } from "vitest";
import { HealingRemoveTestTool } from "../src/agents/healing/tools/remove-test-tool";
import { type ToolEnvelope, executeTool } from "./execute-tool";
import { makeHealingLoop } from "./test-loops";

const FAILING_TEST_CASE_ID = "tc-failing-1";

function removeInput(testCaseId: string) {
    return {
        testCaseId,
        reason: "This proposal is not a viable flow and will never be useful as a test",
    };
}

describe("healing remove_test review-link gate", () => {
    it("records the removal with the review link the runner resolved, which the model never supplies", async () => {
        const loop = makeHealingLoop({
            failureKeysByTestCaseId: new Map([[FAILING_TEST_CASE_ID, "fk-1"]]),
            failureKeys: new Set(["fk-1"]),
            reviewLinksByTestCaseId: new Map([[FAILING_TEST_CASE_ID, { generationReviewId: "gr-1" }]]),
        });

        const result = await executeTool<ToolEnvelope<{ testCaseId: string }>>(
            new HealingRemoveTestTool(),
            removeInput(FAILING_TEST_CASE_ID),
            loop,
        );

        expect(result.success).toBe(true);
        const action = loop.actions[0];
        if (action?.kind !== "remove_test") throw new Error("expected a recorded remove_test action");
        // The input carries no reviewLink; the recorded link is the failure's, attached by the runner.
        expect(action.reviewLink).toEqual({ generationReviewId: "gr-1" });
    });

    it("rejects the removal of a failing test whose failure cites no source review", async () => {
        const loop = makeHealingLoop({
            failureKeysByTestCaseId: new Map([[FAILING_TEST_CASE_ID, "fk-1"]]),
            failureKeys: new Set(["fk-1"]),
            reviewLinksByTestCaseId: new Map(),
        });

        const result = await executeTool<ToolEnvelope<{ testCaseId: string }>>(
            new HealingRemoveTestTool(),
            removeInput(FAILING_TEST_CASE_ID),
            loop,
        );

        expect(result.success).toBe(false);
        if (result.success) throw new Error("expected failure");
        expect(result.error).toContain("source review");
        expect(loop.actions).toHaveLength(0);
    });
});
