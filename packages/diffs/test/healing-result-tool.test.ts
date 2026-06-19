import { describe, expect, it } from "vitest";
import { HealingResultTool } from "../src/agents/healing/healing-result-tool";
import { makeHealingLoop } from "./test-loops";

describe("healing finish tool", () => {
    it("finishes when there are no failures", async () => {
        const loop = makeHealingLoop();
        const tool = new HealingResultTool();

        const result = await tool.buildResult({ reasoning: "nothing to do" }, loop);

        expect(result.actions).toEqual([]);
        expect(result.reasoning).toBe("nothing to do");
    });

    it("rejects finishing while a failure is unhandled", async () => {
        const loop = makeHealingLoop({ failureKeys: new Set(["plan-1"]) });
        const tool = new HealingResultTool();

        await expect(tool.buildResult({ reasoning: "done" }, loop)).rejects.toThrow(/not handled/i);
    });

    it("finishes once every failure has been handled", async () => {
        const loop = makeHealingLoop({ failureKeys: new Set(["plan-1"]) });
        loop.handledFailureKeys.add("plan-1");
        const tool = new HealingResultTool();

        const result = await tool.buildResult({ reasoning: "handled the failure" }, loop);

        expect(result.reasoning).toBe("handled the failure");
    });
});
