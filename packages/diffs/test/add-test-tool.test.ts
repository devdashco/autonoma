import { describe, expect, it } from "vitest";
import { FlowIndex } from "../src/flow-index";
import { ScenarioIndex } from "../src/scenario-index";
import { buildAddTestTool } from "../src/tools";
import type { GeneratedTest } from "../src/tools/add-test-tool";
import { executeTool } from "./execute-tool";

const flowIndex = new FlowIndex([{ id: "auth-folder", name: "auth", testSlugs: [] }]);
const scenarioIndex = new ScenarioIndex([
    { id: "scenario-admin", name: "authenticated-admin", description: "Logged-in admin user" },
]);

describe("add_test tool", () => {
    it("records a new test suggestion", async () => {
        const collector: { newTests: GeneratedTest[] } = { newTests: [] };
        const tool = buildAddTestTool(collector, flowIndex, scenarioIndex);

        const result = await executeTool<{ success: boolean; testName: string }>(tool, {
            name: "New user registration",
            folderName: "auth",
            instruction:
                "Navigate to /signup, fill in name, email, password, click Create Account, assert welcome page",
            url: "https://app.example.com/signup",
            reasoning: "The diff adds a new signup page that has no test coverage",
        });

        expect(result.success).toBe(true);
        expect(result.testName).toBe("New user registration");
        expect(collector.newTests).toHaveLength(1);
        expect(collector.newTests[0]?.instruction).toContain("/signup");
    });

    it("records multiple tests", async () => {
        const collector: { newTests: GeneratedTest[] } = { newTests: [] };
        const tool = buildAddTestTool(collector, flowIndex, scenarioIndex);

        await executeTool(tool, {
            name: "Test A",
            folderName: "auth",
            instruction: "Do A",
            reasoning: "Reason A",
        });
        await executeTool(tool, {
            name: "Test B",
            folderName: "auth",
            instruction: "Do B",
            reasoning: "Reason B",
        });

        expect(collector.newTests).toHaveLength(2);
    });

    it("records scenarioId when provided", async () => {
        const collector: { newTests: GeneratedTest[] } = { newTests: [] };
        const tool = buildAddTestTool(collector, flowIndex, scenarioIndex);

        const result = await executeTool<{ success: boolean }>(tool, {
            name: "Admin dashboard",
            folderName: "auth",
            instruction: "Visit /admin and assert the dashboard loads",
            reasoning: "The diff adds an admin-only dashboard",
            scenarioId: "scenario-admin",
        });

        expect(result.success).toBe(true);
        expect(collector.newTests[0]?.scenarioId).toBe("scenario-admin");
    });

    it("rejects an unknown scenarioId", async () => {
        const collector: { newTests: GeneratedTest[] } = { newTests: [] };
        const tool = buildAddTestTool(collector, flowIndex, scenarioIndex);

        const result = await executeTool<{ success: boolean; error?: string }>(tool, {
            name: "Broken",
            folderName: "auth",
            instruction: "Do something",
            reasoning: "Reason",
            scenarioId: "does-not-exist",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("does-not-exist");
        expect(collector.newTests).toHaveLength(0);
    });

    it("rejects an unknown folder", async () => {
        const collector: { newTests: GeneratedTest[] } = { newTests: [] };
        const tool = buildAddTestTool(collector, flowIndex, scenarioIndex);

        const result = await executeTool<{ success: boolean; error?: string }>(tool, {
            name: "Broken",
            folderName: "nonexistent",
            instruction: "Do something",
            reasoning: "Reason",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("nonexistent");
    });
});
