import { basename } from "node:path";
import { type LanguageModel } from "ai";
import { tool } from "ai";
import { runAgent, buildDefaultStepLogger } from "../../core/agent";
import { buildReadFileTool, buildGrepTool, buildGlobTool, buildBashTool } from "../../tools";
import { reviewResultRecordSchema, type ReviewRubric, type DimensionResult } from "./rubrics";

export async function runReviewPass(
    testContent: string,
    testPath: string,
    rubric: ReviewRubric,
    projectRoot: string,
    model: LanguageModel,
    scenarioData?: string,
): Promise<Record<string, DimensionResult> | undefined> {
    let result: Record<string, DimensionResult> | undefined;

    const agentLabel = `review:${rubric.name}:${basename(testPath)}`;
    const { onStepFinish } = buildDefaultStepLogger(agentLabel, rubric.maxSteps);

    const finishTool = tool({
        description: "Submit your structured review. Every dimension must have evidence from your investigation.",
        inputSchema: rubric.resultSchema,
        execute: async (input) => {
            // input already satisfied rubric.resultSchema upstream; re-parsing through
            // the concrete record schema recovers the precise type without an assertion.
            result = reviewResultRecordSchema.parse(input);
        },
    });

    const agentConfig = {
        id: agentLabel,
        systemPrompt: rubric.systemPrompt,
        model,
        maxSteps: rubric.maxSteps,
        tools: (_heartbeat: () => void) => ({
            read_file: buildReadFileTool(projectRoot),
            grep: buildGrepTool(projectRoot),
            glob: buildGlobTool(projectRoot),
            bash: buildBashTool(projectRoot),
            finish: finishTool,
        }),
        onStepFinish,
    };

    const scenarioContext =
        scenarioData && rubric.name === "data-accuracy"
            ? `\n## Scenario data (the ONLY test data that exists in the database)\n\`\`\`\n${scenarioData}\n\`\`\`\n\nIMPORTANT: Every piece of data the test references (names, titles, URLs, folder names, etc.) MUST exist in the scenario data above. If the test uses a value that doesn't appear in scenarios, it FAILS the dataAccuracy dimension.\n`
            : "";

    const prompt = `Review this E2E test plan:

## Test file: ${testPath}
\`\`\`
${testContent}
\`\`\`
${scenarioContext}
Evaluate EVERY dimension in your rubric: ${rubric.dimensions.join(", ")}

For each one:
1. Investigate using your tools (read source files, grep for strings referenced in the test)
2. Provide specific evidence of what you found
3. Pass or fail with a clear reason

When done, call finish with your structured evaluation.`;

    await runAgent(agentConfig, prompt, () => result);
    return result ?? undefined;
}
