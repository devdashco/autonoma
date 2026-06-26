import { describe, expect, it } from "vitest";
import { createToolBudget } from "../src/tool-output";

describe("tool output budget", () => {
    it("passes a normal-sized result through untouched", () => {
        const cap = createToolBudget();
        expect(cap("hello world", { tool: "read_code", mode: "narrow", maxChars: 1000 })).toBe("hello world");
    });

    it("reads a big file in full when it fits the per-call cap (big files are not over-clamped)", () => {
        const cap = createToolBudget();
        const bigFile = "x".repeat(140_000); // ~3,000 lines, under the 150k read_code cap
        expect(cap(bigFile, { tool: "read_code", mode: "narrow", maxChars: 150_000 })).toBe(bigFile);
    });

    it("narrow mode drops an oversized read and nudges the model to re-call scoped to what it needs", () => {
        const cap = createToolBudget();
        const huge = "x".repeat(500_000);
        const out = cap(huge, { tool: "read_code", mode: "narrow", maxChars: 150_000, hint: "a smaller range." });
        expect(out).not.toContain("xxxxxxxxxxxxxxxxxxxx"); // the oversized content is gone, not inlined
        expect(out).toContain("read_code");
        expect(out).toContain("Re-call");
        expect(out).toContain("a smaller range.");
        expect(out.length).toBeLessThan(600); // just the nudge
    });

    it("truncate mode keeps head+tail for tools we must not re-run (run_script / vision)", () => {
        const cap = createToolBudget();
        const big = `HEAD${"z".repeat(100_000)}TAIL`;
        const out = cap(big, { tool: "run_script", mode: "truncate", maxChars: 10_000 });
        expect(out.startsWith("HEAD")).toBe(true);
        expect(out.endsWith("TAIL")).toBe(true);
        expect(out).toContain("omitted");
        expect(out).not.toContain("Re-call"); // truncate never tells a side-effecting tool to re-run
        expect(out.length).toBeLessThan(12_000);
    });

    it("enforces a cumulative per-run budget: later big reads get narrowed once the budget is spent", () => {
        const cap = createToolBudget(120_000); // small total budget for the test
        const first = cap("a".repeat(100_000), { tool: "read_code", mode: "narrow", maxChars: 150_000 });
        expect(first).toBe("a".repeat(100_000)); // fits within both the per-call cap and the remaining budget
        const second = cap("b".repeat(100_000), { tool: "read_code", mode: "narrow", maxChars: 150_000 });
        expect(second).toContain("Re-call"); // budget mostly spent -> narrowed
        expect(second).not.toContain("bbbbbbbbbbbbbbbbbbbb");
    });

    it("a dropped (narrowed) result costs nothing, so re-calling with a tighter scope still has budget", () => {
        const cap = createToolBudget(120_000);
        cap("z".repeat(500_000), { tool: "read_code", mode: "narrow", maxChars: 150_000 }); // dropped -> nudge
        const next = cap("y".repeat(100_000), { tool: "read_code", mode: "narrow", maxChars: 150_000 });
        expect(next).toBe("y".repeat(100_000)); // the dropped huge result did not eat the budget
    });
});
