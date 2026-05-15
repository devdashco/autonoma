import { tool } from "ai";
import { z } from "zod";
import type { FlowIndex } from "../flow-index";
import type { ScenarioIndex } from "../scenario-index";

export const generatedTestSchema = z.object({
    name: z.string().describe("Test name"),
    folderName: z.string().describe("Name of the folder to add the test to"),
    instruction: z.string().describe("Natural language test instruction"),
    url: z.string().optional().describe("URL to navigate to for the test"),
    reasoning: z.string().describe("Why this test was generated based on the diff"),
    scenarioId: z
        .string()
        .optional()
        .describe(
            "Id of the scenario whose seeded data this test depends on (obtained from `list_scenarios` / " +
                "`read_scenario`). Provide when the test needs preconditions like an authenticated user or " +
                "pre-existing records. Omit for tests that start from a fresh, unauthenticated state.",
        ),
    acceptingCandidateId: z
        .string()
        .optional()
        .describe(
            "Set this to the `candidate` id from the Test Candidates list when you are accepting one of those " +
                "candidates. Omit when you are creating a test that wasn't proposed in Step 1.",
        ),
});

export type GeneratedTest = z.infer<typeof generatedTestSchema>;

export function buildAddTestTool(
    collector: { newTests: GeneratedTest[] },
    flowIndex: FlowIndex,
    scenarioIndex: ScenarioIndex,
) {
    return tool({
        description:
            "Add a new test for functionality that has no test coverage. " +
            "Use this when the diff introduces new user-facing behavior that no existing test covers.",
        inputSchema: generatedTestSchema,
        execute: async (input) => {
            if (flowIndex.getFlow(input.folderName) === undefined) {
                return { success: false, error: `Folder "${input.folderName}" not found` };
            }
            if (input.scenarioId != null && !scenarioIndex.hasScenario(input.scenarioId)) {
                return {
                    success: false,
                    error:
                        `Scenario "${input.scenarioId}" not found. Call \`list_scenarios\` to see available ` +
                        `scenarios, or omit scenarioId if the test does not need seeded data.`,
                };
            }
            collector.newTests.push(input);
            return { success: true, testName: input.name };
        },
    });
}
