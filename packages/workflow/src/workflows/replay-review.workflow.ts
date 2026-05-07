import { proxyActivities } from "@temporalio/workflow";
import type { GeneralActivities } from "../activities";
import { TaskQueue } from "../task-queues";

const general = proxyActivities<GeneralActivities>({
    startToCloseTimeout: "15m",
    heartbeatTimeout: "2m",
    retry: { maximumAttempts: 1 },
    taskQueue: TaskQueue.GENERAL,
});

export interface ReplayReviewInput {
    runId: string;
    skipIssueBugCreation?: boolean;
}

export async function replayReviewWorkflow(input: ReplayReviewInput): Promise<void> {
    const reviewOutput = await general.reviewReplay({ runId: input.runId });
    if (reviewOutput.status !== "completed" || reviewOutput.verdict == null) return;
    await general.createIssueFromRunReview({
        runId: input.runId,
        verdict: reviewOutput.verdict,
        skipBugCreation: input.skipIssueBugCreation,
    });
}
