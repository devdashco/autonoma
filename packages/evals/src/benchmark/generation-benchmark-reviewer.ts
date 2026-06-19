import { z } from "zod";
import { BenchmarkReviewer } from "./benchmark-reviewer-base";

const GenerationVerdictSchema = z.object({
    verdict: z.enum(["success", "suboptimal", "agent_limitation", "plan_mismatch", "application_bug"]),
    reasoning: z.string(),
});

export type GenerationBenchmarkVerdict = z.infer<typeof GenerationVerdictSchema>;

export class GenerationBenchmarkReviewer extends BenchmarkReviewer<GenerationBenchmarkVerdict> {
    constructor() {
        super({
            schema: GenerationVerdictSchema,
            systemPrompt: `You are reviewing an automated test generation result.
Classify the outcome into exactly one of these categories:

- success: The agent completed the test plan correctly and efficiently.
- suboptimal: The agent completed the test plan but with excessive steps, loops, or unnecessary backtracking.
- plan_mismatch: The agent failed because the test plan referenced UI elements, routes, or data that do not exist in the app.
- agent_limitation: The agent failed despite a valid test plan - it could not navigate the UI or got stuck.
- application_bug: The agent failed because the application itself has a bug or broken behavior.

Be concise in your reasoning (1-2 sentences).`,
        });
    }

    async reviewGeneration(params: {
        testPlanPrompt: string;
        status: string;
        reasoning: string | null;
        stepCount: number;
    }): Promise<GenerationBenchmarkVerdict> {
        const { testPlanPrompt, status, reasoning, stepCount } = params;
        const message = [
            `Test plan: ${testPlanPrompt}`,
            `Status: ${status}`,
            `Step count: ${stepCount}`,
            reasoning != null ? `Agent reasoning: ${reasoning}` : null,
        ]
            .filter(Boolean)
            .join("\n");
        return this.review(message);
    }
}
