import { z } from "zod";
import { BenchmarkReviewer } from "./benchmark-reviewer-base";

const ReplayVerdictSchema = z.object({
    verdict: z.enum(["engine_error", "application_bug"]),
    reasoning: z.string(),
});

export type ReplayBenchmarkVerdict = z.infer<typeof ReplayVerdictSchema>;

export class ReplayBenchmarkReviewer extends BenchmarkReviewer<ReplayBenchmarkVerdict> {
    constructor() {
        super({
            schema: ReplayVerdictSchema,
            systemPrompt: `You are reviewing a failed automated test replay.
A replay re-executes stored steps deterministically - there is no AI agent deciding what to do.

Classify the failure into exactly one of these two categories:

- engine_error: The recorded steps are stale. The UI changed since the steps were generated so the replay engine cannot find the elements or follow the flow. The application is fine; the test needs to be regenerated.
- application_bug: The application has a real bug. The steps still reference correct UI but the application misbehaved - error message, crash, broken flow, wrong data.

Be concise in your reasoning (1-2 sentences).`,
        });
    }

    async reviewReplay(params: { testPlanPrompt: string; reasoning: string | null }): Promise<ReplayBenchmarkVerdict> {
        const { testPlanPrompt, reasoning } = params;
        const message = [
            `Test plan: ${testPlanPrompt}`,
            reasoning != null ? `Replay engine reasoning: ${reasoning}` : null,
        ]
            .filter(Boolean)
            .join("\n");
        return this.review(message);
    }
}
