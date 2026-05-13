import { db } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import { AddTest, TestSuiteUpdater } from "@autonoma/test-updates";
import type { ApplyAddTestInput } from "./types";

export async function applyAddTest(input: ApplyAddTestInput): Promise<{ planId: string }> {
    const logger = rootLogger.child({
        name: "applyAddTest",
        snapshotId: input.snapshotId,
        testName: input.name,
    });
    logger.info("Applying add_test");

    let scenarioName: string | undefined;
    if (input.scenarioId != null) {
        const scenario = await db.scenario.findUnique({
            where: { id: input.scenarioId },
            select: { name: true },
        });
        scenarioName = scenario?.name;
    }

    const updater = await TestSuiteUpdater.continueUpdateBySnapshot({
        db,
        snapshotId: input.snapshotId,
        organizationId: input.organizationId,
    });

    const { testCaseId, planId } = await updater.apply(
        new AddTest({
            name: input.name,
            plan: input.prompt,
            folderId: input.folderId,
            scenarioId: input.scenarioId,
            scenarioName,
        }),
    );
    logger.info("Test case created and generation queued", { testCaseId, planId });

    // Backfill testCaseId + planId on the RefinementAction row and stamp it
    // applied. planId is required so future analysis can reach this row's plan
    // without re-resolving by name.
    if (input.refinementActionId != null) {
        await db.refinementAction.update({
            where: { id: input.refinementActionId },
            data: { testCaseId, planId, appliedAt: new Date() },
        });
    }

    return { planId };
}
