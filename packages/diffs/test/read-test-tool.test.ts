import { describe, expect, it } from "vitest";
import type { ExistingTestInfo, QuarantineInfo } from "../src/diffs-agent";
import { buildReadTestTool } from "../src/tools";
import { executeTool } from "./execute-tool";

const tests: ExistingTestInfo[] = [
    { id: "t1", slug: "login", name: "Login", prompt: "Log in." },
    { id: "t2", slug: "checkout", name: "Checkout", prompt: "Buy something." },
    {
        id: "t3",
        slug: "broken-engine-flow",
        name: "Broken engine flow",
        prompt: "Drag and drop the item.",
        quarantine: { reason: "engine_limitation", issueId: "issue_42" },
    },
];

type ReadResult = {
    results: Record<string, { name: string; instruction: string; quarantine?: QuarantineInfo } | { error: string }>;
};

describe("read_tests tool", () => {
    it("returns the instructions for one or more known slugs in a single call", async () => {
        const tool = buildReadTestTool(tests);

        const result = await executeTool<ReadResult>(tool, { slugs: ["login", "checkout"] });

        expect(result.results.login).toEqual({ name: "Login", instruction: "Log in.", quarantine: undefined });
        expect(result.results.checkout).toEqual({
            name: "Checkout",
            instruction: "Buy something.",
            quarantine: undefined,
        });
    });

    it("includes quarantine info when set", async () => {
        const tool = buildReadTestTool(tests);

        const result = await executeTool<ReadResult>(tool, { slugs: ["broken-engine-flow"] });

        const entry = result.results["broken-engine-flow"];
        expect(entry).toMatchObject({ quarantine: { reason: "engine_limitation", issueId: "issue_42" } });
    });

    it("reports a per-slug error for unknown slugs while still returning known ones", async () => {
        const tool = buildReadTestTool(tests);

        const result = await executeTool<ReadResult>(tool, { slugs: ["login", "made-up"] });

        expect(result.results.login).toMatchObject({ name: "Login" });
        const missing = result.results["made-up"] as { error: string };
        expect(missing.error).toContain("not found");
    });
});
