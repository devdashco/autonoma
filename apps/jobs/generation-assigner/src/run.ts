import { db } from "@autonoma/db";
import { logger } from "@autonoma/logger";
import { TestSuiteUpdater } from "@autonoma/test-updates";

export async function runGenerationAssignment(generationIds: string[], autoActivate: boolean): Promise<void> {
    logger.info("Starting generation assigner", { generationIds, autoActivate });

    const firstGeneration = await db.testGeneration.findUniqueOrThrow({
        // biome-ignore lint/style/noNonNullAssertion: validated by caller
        where: { id: generationIds[0]! },
        select: { snapshot: { select: { branchId: true } } },
    });

    const branchId = firstGeneration.snapshot.branchId;
    logger.info("Resolved branch from generation", { branchId });

    const updater = await TestSuiteUpdater.continueUpdate({ db, branchId });
    const { assigned, failed } = await updater.assignGenerationResults(generationIds);
    logger.info("Generation results assigned", { assigned, failed });

    if (autoActivate) {
        await updater.finalize();
        logger.info("Snapshot finalized");
    } else {
        logger.info("Skipping finalization (autoActivate=false)");
    }
}
