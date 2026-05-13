import { executeChild, proxyActivities } from "@temporalio/workflow";
import type { GeneralActivities } from "../activities/general-activities";
import { TaskQueue } from "../task-queues";
import { WORKFLOW_TYPE } from "./workflow-types";

const general = proxyActivities<GeneralActivities>({
    startToCloseTimeout: "10m",
    heartbeatTimeout: "1m",
    retry: { maximumAttempts: 1 },
    taskQueue: TaskQueue.GENERAL,
});

const longRunning = proxyActivities<GeneralActivities>({
    startToCloseTimeout: "30m",
    heartbeatTimeout: "2m",
    retry: { maximumAttempts: 1 },
    taskQueue: TaskQueue.GENERAL,
});

export interface RefinementLoopInput {
    snapshotId: string;
    triggeredBy: "onboarding" | "diffs";
    maxIterations?: number;
}

export interface RefinementLoopResult {
    loopId: string;
    status: "converged" | "max_iterations" | "error";
    iterations: number;
    validatedTestCaseIds: string[];
}

const DEFAULT_MAX_ITERATIONS = 3;

/**
 * Refinement loop.
 *
 * Each iteration has the same shape: analyze results that already exist, heal
 * if any failed, then (if healing produced plan changes) fire the next
 * iteration's gen-replay pipeline. Iter 1's analyzable data is fired by the
 * init phase below; subsequent iterations have their data fired by the
 * previous iteration's tail. "Iter 1 is special" disappears from the body.
 *
 * The loop's scope - which plans each iteration is responsible for - is
 * recorded in `RefinementIterationInput` rows. Iter 1's rows come from the
 * snapshot's pending generations at init time (= upstream's "work the loop
 * must finish"); iter N+1's rows come from the planIds that healing's
 * update_plan / add_test actions produced. `analyzeResults` reads that table
 * directly; the loop has no implicit reads of upstream state.
 */
export async function refinementLoopWorkflow(input: RefinementLoopInput): Promise<RefinementLoopResult> {
    const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    // --- Init phase: create loop + iter 1 from snapshot's pending gens ---
    const { loopId, organizationId, firstIterationId, hasPendingWork } = await general.initRefinementLoop({
        snapshotId: input.snapshotId,
        triggeredBy: input.triggeredBy,
    });

    if (hasPendingWork) {
        await executeChild(WORKFLOW_TYPE.RUN_GENERATION_PIPELINE, {
            workflowId: `gen-pipeline-${loopId}-iter-1`,
            taskQueue: TaskQueue.GENERAL,
            args: [
                {
                    snapshotId: input.snapshotId,
                    organizationId,
                    loopId,
                    iterationNumber: 1,
                },
            ],
        });
    }

    // --- Iteration loop: analyze, heal, fire next ---
    const validatedTestCaseIds = new Set<string>();
    let finalStatus: "converged" | "max_iterations" | "error" = "max_iterations";
    let iterationsRun = 0;
    let currentIterationId = firstIterationId;
    let currentIterationNumber = 1;

    try {
        while (currentIterationNumber <= maxIterations) {
            iterationsRun = currentIterationNumber;

            await general.markRefinementIterationRunning({ iterationId: currentIterationId });

            const results = await general.analyzeResults({ iterationId: currentIterationId });
            for (const tcId of results.validatedTestCaseIds) validatedTestCaseIds.add(tcId);

            const hasFailures = results.failuresAtGeneration.length > 0 || results.failuresAtReplay.length > 0;

            if (!hasFailures) {
                finalStatus = "converged";
                await general.finishRefinementIteration({ iterationId: currentIterationId });
                break;
            }

            const triage = await longRunning.runHealingAgentForRefinement({
                iterationId: currentIterationId,
                iteration: currentIterationNumber,
                snapshotId: input.snapshotId,
                organizationId,
                failuresAtGeneration: results.failuresAtGeneration,
                failuresAtReplay: results.failuresAtReplay,
            });

            const applyResult = await general.applyHealingActions({
                snapshotId: input.snapshotId,
                organizationId,
                actions: triage.persistedActions,
                currentIterationId,
                currentIterationNumber,
            });

            await general.finishRefinementIteration({ iterationId: currentIterationId });

            if (applyResult.nextIterationId == null) {
                // Healing produced only report_bug / report_engine_limitation / remove_test:
                // nothing more to refine. The reports stand as outputs; loop converges.
                finalStatus = "converged";
                break;
            }

            // Fire iter N+1's pipeline. By invariant, the pending gens in the
            // snapshot at this point are exactly the ones healing's
            // TestSuiteChange.apply queued for the planIds applyHealingActions
            // just recorded as iter N+1's inputs.
            await executeChild(WORKFLOW_TYPE.RUN_GENERATION_PIPELINE, {
                workflowId: `gen-pipeline-${loopId}-iter-${currentIterationNumber + 1}`,
                taskQueue: TaskQueue.GENERAL,
                args: [
                    {
                        snapshotId: input.snapshotId,
                        organizationId,
                        loopId,
                        iterationNumber: currentIterationNumber + 1,
                    },
                ],
            });

            currentIterationId = applyResult.nextIterationId;
            currentIterationNumber += 1;
        }

        await general.finishRefinementLoop({ loopId, status: finalStatus });
    } catch (e) {
        await general.finishRefinementLoop({ loopId, status: "error" });
        throw e;
    }

    await general.finalizePendingSnapshot({ snapshotId: input.snapshotId });

    return {
        loopId,
        status: finalStatus,
        iterations: iterationsRun,
        validatedTestCaseIds: [...validatedTestCaseIds],
    };
}
