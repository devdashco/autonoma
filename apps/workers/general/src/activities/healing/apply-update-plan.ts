import { db } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import { TestSuiteUpdater, UpdateTest } from "@autonoma/test-updates";
import { markActionApplied } from "./mark-applied";
import type { ApplyUpdatePlanInput } from "./types";

export async function applyUpdatePlan(input: ApplyUpdatePlanInput): Promise<{ planId: string }> {
    const logger = rootLogger.child({
        name: "applyUpdatePlan",
        snapshotId: input.snapshotId,
        testCaseId: input.testCaseId,
    });
    logger.info("Applying update_plan");

    // Preserve scenario binding from the previous plan.
    const existing = await db.testCaseAssignment.findUniqueOrThrow({
        where: { snapshotId_testCaseId: { snapshotId: input.snapshotId, testCaseId: input.testCaseId } },
        select: { plan: { select: { scenarioId: true } } },
    });
    const scenarioId = existing.plan?.scenarioId ?? undefined;

    const updater = await TestSuiteUpdater.continueUpdateBySnapshot({
        db,
        snapshotId: input.snapshotId,
        organizationId: input.organizationId,
    });

    const { planId } = await updater.apply(
        new UpdateTest({
            testCaseId: input.testCaseId,
            plan: input.newPrompt,
            scenarioId,
        }),
    );
    logger.info("Plan updated and generation queued", { planId });

    await markActionApplied(input.refinementActionId);

    return { planId };
}
