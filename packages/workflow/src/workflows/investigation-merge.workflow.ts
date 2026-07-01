import { log, proxyActivities } from "@temporalio/workflow";
import type { InvestigationActivities, MergeInvestigationEditsInput } from "../activities";
import { TaskQueue } from "../task-queues";

const investigation = proxyActivities<InvestigationActivities>({
    startToCloseTimeout: "10m",
    heartbeatTimeout: "2m",
    // Retry transient failures (a DB blip, a non-model error the reconciler's own retry doesn't cover): the
    // merge workflow id is idempotent and rejects redelivered webhooks, so without this a transient failure
    // would permanently strand the twin's edits with no recovery path.
    retry: { maximumAttempts: 3 },
    taskQueue: TaskQueue.INVESTIGATION,
});

export type InvestigationMergeWorkflowInput = MergeInvestigationEditsInput;

/**
 * Merge-with-main: after a PR merges, reconcile the branch twin's proposed test edits into main's current
 * suite (which other merges may have moved) and apply the accepted ones onto a detached main-proposal
 * snapshot. A single reconcile+apply activity does all the work - there is no browser loop - so the workflow
 * is a thin wrapper that gives the job Temporal's retry/observability envelope and an idempotent id.
 */
export async function investigationMergeWorkflow(input: InvestigationMergeWorkflowInput): Promise<void> {
    const ids = { snapshot: { snapshotId: input.twinSnapshotId } };
    log.info("Investigation merge workflow started", { ...ids, extra: { mainSnapshotId: input.mainSnapshotId } });

    const result = await investigation.mergeInvestigationEdits(input);

    log.info("Investigation merge workflow completed", {
        ...ids,
        extra: {
            mainProposalSnapshotId: result.mainProposalSnapshotId,
            applied: result.appliedCount,
            skipped: result.skippedCount,
        },
    });
}
