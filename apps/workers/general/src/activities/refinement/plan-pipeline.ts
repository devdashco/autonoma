import { db } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import { TestSuiteUpdater } from "@autonoma/test-updates";
import type {
    PrepareGenerationQueueInput,
    PrepareGenerationQueueOutput,
    WorkflowArchitecture,
} from "@autonoma/workflow/activities";

/**
 * Validates deployment, marks every pending generation in the snapshot as queued,
 * and returns the list ready for dispatch.
 *
 * Invariant this depends on: at call time, the snapshot's pending generations
 * are exactly the set of plans the current iteration owns. See the same
 * invariant note on `initRefinementLoop` in loop-lifecycle.ts - the refinement
 * loop maintains it via two arms:
 *
 *   - Iter 1: upstream's pre-loop activity queues exactly the plans needing
 *     refinement; `initRefinementLoop` reads them as iter 1's inputs.
 *   - Iter N+1: `applyHealingActions` calls `addJob` (via `TestSuiteChange.apply`)
 *     exactly for the planIds it records in `RefinementIterationInput` for
 *     iter N+1. Prior iter's gens are terminal (success/failed), not pending,
 *     so the new pending rows are exactly the planIds that need firing.
 *
 * If a future code path queues pending generations outside the refinement loop's
 * coordination, this activity will sweep them into the current iteration's
 * dispatch. New pending-gen-creator paths must coordinate with the loop or use
 * a different status to remain invisible here.
 */
export async function prepareGenerationQueue(
    input: PrepareGenerationQueueInput,
): Promise<PrepareGenerationQueueOutput> {
    const logger = rootLogger.child({ name: "prepareGenerationQueue" });
    logger.info("Preparing generation queue for snapshot");

    const updater = await TestSuiteUpdater.continueUpdateBySnapshot({
        db,
        snapshotId: input.snapshotId,
        organizationId: input.organizationId,
    });

    const prepared = await updater.prepareGenerationQueue();

    logger.info("Generation queue prepared", { extra: { count: prepared.length } });

    return {
        generations: prepared.map((p) => ({
            testGenerationId: p.testGenerationId,
            scenarioId: p.scenarioId,
            architecture: p.architecture as WorkflowArchitecture,
        })),
    };
}
