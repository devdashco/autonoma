import { executeChild, proxyActivities } from "@temporalio/workflow";
import type { DiffsActivities } from "../activities";
import { TaskQueue } from "../task-queues";
import type { WorkflowArchitecture } from "../types";
import { WORKFLOW_TYPE } from "./workflow-types";

const longRunning = proxyActivities<DiffsActivities>({
    startToCloseTimeout: "30m",
    heartbeatTimeout: "2m",
    retry: { maximumAttempts: 1 },
    taskQueue: TaskQueue.DIFFS,
});

const standard = proxyActivities<DiffsActivities>({
    startToCloseTimeout: "15m",
    heartbeatTimeout: "2m",
    retry: { maximumAttempts: 1 },
    taskQueue: TaskQueue.DIFFS,
});

const shortLived = proxyActivities<DiffsActivities>({
    startToCloseTimeout: "10m",
    heartbeatTimeout: "2m",
    retry: { maximumAttempts: 1 },
    taskQueue: TaskQueue.DIFFS,
});

export interface DiffsAnalysisInput {
    snapshotId: string;
}

interface RunReplayArgs {
    runId: string;
    architecture: WorkflowArchitecture;
    scenarioId?: string;
}

function dispatchReplay({ runId, architecture, scenarioId }: RunReplayArgs): Promise<void> {
    return executeChild(WORKFLOW_TYPE.RUN_REPLAY, {
        workflowId: `run-replay-${runId}`,
        taskQueue: TaskQueue.GENERAL,
        args: [{ runId, architecture, scenarioId }],
    });
}

export async function diffsAnalysisWorkflow(input: DiffsAnalysisInput): Promise<void> {
    const { snapshotId } = input;

    // Step 1: Analyze diffs - explores code, updates skills, identifies affected tests, suggests new tests.
    // Persists DiffsJob.analysisReasoning, AffectedTest, TestCandidate, and Run records.
    const step1 = await longRunning.analyzeDiffs({ snapshotId });

    // Step 2: Execute affected test replays in parallel.
    // The replay-reviewer fires automatically in each replay workflow's finally block,
    // populating RunReview records (but skipping Issue/Bug creation for diffs replays).
    if (step1.replays.length > 0) {
        await Promise.allSettled(step1.replays.map((run) => dispatchReplay(run)));
    }

    // Step 3: Resolve - reads reviewer verdicts from DB, modifies stale tests, gathers pending generations.
    // Persists DiffsJob.resolutionReasoning and reconciles AffectedTest/TestCandidate links.
    await standard.resolveDiffs({ snapshotId });

    // Step 4: Run the refinement loop synchronously. The loop reads pending
    // gens from the snapshot as its iter-1 scope, fires + analyzes them, heals
    // failures, and activates the snapshot on completion. We surface refinement
    // failures through the DiffsJob status so UI consumers (which poll by job
    // status) see the failure rather than seeing the job hung in "generating".
    try {
        await executeChild(WORKFLOW_TYPE.REFINEMENT_LOOP, {
            workflowId: `refinement-loop-${snapshotId}`,
            taskQueue: TaskQueue.GENERAL,
            args: [{ snapshotId, triggeredBy: "diffs" as const }],
        });
    } catch (error) {
        await shortLived.finalizeDiffs({
            snapshotId,
            failureReason: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }

    // Step 5: Mark the DiffsJob completed. Runs after the refinement loop so
    // the job's terminal status reflects the full pipeline including refinement.
    await shortLived.finalizeDiffs({ snapshotId });
}
