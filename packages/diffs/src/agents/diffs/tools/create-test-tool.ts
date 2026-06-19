import { AgentTool, FixableToolError } from "@autonoma/ai";
import { z } from "zod";
import type { DiffsAgentLoop } from "../diffs-agent-loop";

export const createTestSchema = z.object({
    name: z.string().describe("Test name"),
    folderName: z.string().describe("Name of the folder (flow) to add the test to"),
    plan: z
        .string()
        .min(1)
        .describe(
            "The complete, generation-ready natural-language test plan body. Write the full instructions a " +
                "generator can turn directly into steps - not a high-level summary. This is the final plan; there " +
                "is no later refinement of the wording before it runs.",
        ),
    scenarioId: z
        .string()
        .optional()
        .describe(
            "Id of the scenario whose seeded data this test depends on (obtained from `list_scenarios` / " +
                "`read_scenario`). Provide when the test needs preconditions like an authenticated user or " +
                "pre-existing records. Omit for tests that start from a fresh, unauthenticated state.",
        ),
    coverageJustification: z
        .string()
        .min(1)
        .describe(
            "Why existing tests do not already cover this flow. Name the closest existing tests (by slug) and " +
                "explain what behavior this test exercises that they do not. Required: nothing culls a " +
                "passing-but-redundant test once it is created, so deduplication happens here.",
        ),
});

export type CreatedTest = z.infer<typeof createTestSchema>;

interface CreateTestOutput {
    testName: string;
}

class UnknownFolderError extends FixableToolError {
    constructor(public readonly folderName: string) {
        super(`Folder "${folderName}" not found`);
    }

    override suggestFix(): string {
        return "Call `list_flows` to see the available folder names, then try again with one of those.";
    }
}

class UnknownScenarioError extends FixableToolError {
    constructor(public readonly scenarioId: string) {
        super(
            `Scenario "${scenarioId}" not found. Call \`list_scenarios\` to see available ` +
                `scenarios, or omit scenarioId if the test does not need seeded data.`,
        );
    }
}

/**
 * Action tool: author a brand-new test for behavior the diff introduces that no
 * existing test covers.
 *
 * `create_test` is the sole author of new tests in the diff flow: the runner
 * mints the test case + plan + a pending generation immediately, and the test is
 * generated, run, and healed alongside the affected tests. There is no pre-gate
 * that culls a passing-but-redundant test, so the boundary validates the folder
 * + scenario and the schema forces a `coverageJustification`; redundancy must be
 * ruled out here.
 */
export class CreateTestTool extends AgentTool<CreatedTest, CreateTestOutput, DiffsAgentLoop> {
    constructor() {
        super({
            name: "create_test",
            description:
                "Author a brand-new test for user-facing behavior the diff introduces that no existing test covers. " +
                "The test is created immediately (test case + plan + a pending generation) and is generated, run, and " +
                "healed alongside the affected tests - there is no later review gate, so only create tests you are " +
                "confident are real, non-redundant flows. Provide a `coverageJustification` that names why existing " +
                "tests do not already cover this.",
            inputSchema: createTestSchema,
        });
    }

    protected async execute(input: CreatedTest, loop: DiffsAgentLoop): Promise<CreateTestOutput> {
        if (loop.flowIndex.getFlow(input.folderName) === undefined) throw new UnknownFolderError(input.folderName);
        if (input.scenarioId != null && !loop.scenarioIndex.hasScenario(input.scenarioId)) {
            throw new UnknownScenarioError(input.scenarioId);
        }

        loop.createdTests.push(input);
        return { testName: input.name };
    }
}
