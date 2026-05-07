import { proxyActivities } from "@temporalio/workflow";
import type { GeneralActivities } from "../activities";
import { TaskQueue } from "../task-queues";

const general = proxyActivities<GeneralActivities>({
    startToCloseTimeout: "15m",
    heartbeatTimeout: "2m",
    retry: { maximumAttempts: 1 },
    taskQueue: TaskQueue.GENERAL,
});

export interface GenerationReviewInput {
    generationId: string;
    skipIssueBugCreation?: boolean;
}

export async function generationReviewWorkflow(input: GenerationReviewInput): Promise<void> {
    const reviewOutput = await general.reviewGeneration({ generationId: input.generationId });
    if (reviewOutput.status !== "completed" || reviewOutput.verdict == null) return;
    if (reviewOutput.verdict.verdict === "success") return;
    await general.createIssueFromGenerationReview({
        generationId: input.generationId,
        verdict: reviewOutput.verdict,
        skipBugCreation: input.skipIssueBugCreation,
    });
}
