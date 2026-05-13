import { db } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import { TestSuiteUpdater } from "@autonoma/test-updates";
import type { AssignGenerationResultsInput } from "@autonoma/workflow/activities";
import { Context } from "@temporalio/activity";

/**
 * Copies stepsId from each successful generation onto the snapshot's
 * corresponding test-case assignment so the downstream replay has something to
 * execute against. Activation of the snapshot is the refinement loop's
 * responsibility, not this activity's.
 */
export async function assignGenerationResults(input: AssignGenerationResultsInput): Promise<void> {
    const logger = rootLogger.child({ name: "assignGenerationResults", snapshotId: input.snapshotId });
    logger.info("Assigning generation results", { generationIds: input.generationIds });

    if (input.generationIds.length === 0) {
        logger.info("No generations to assign");
        return;
    }

    const heartbeat = setInterval(() => Context.current().heartbeat(), 30_000);
    try {
        const updater = await TestSuiteUpdater.continueUpdateBySnapshot({
            db,
            snapshotId: input.snapshotId,
        });

        const { assigned, failed } = await updater.assignGenerationResults(input.generationIds);
        logger.info("Generation results assigned", { assigned, failed });
    } finally {
        clearInterval(heartbeat);
    }
}
