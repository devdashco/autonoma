import { db } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import { AddTest, TestSuiteUpdater } from "@autonoma/test-updates";
import { markActionApplied } from "./mark-applied";
import type { ApplyAddTestInput } from "./types";

/**
 * Mints a brand-new test for the snapshot: creates a TestCase, its TestPlan, and
 * a TestCaseAssignment, then queues the plan's first generation. Returns the new
 * plan id (folded into iteration N+1's analysis scope, like applyUpdatePlan) plus
 * the new test case id (the first-turn apply tail links an accepted candidate to
 * it). The new test then enters the next iteration's generate/run/review cycle.
 */
export async function applyAddTest(input: ApplyAddTestInput): Promise<{ planId: string; testCaseId: string }> {
    const logger = rootLogger.child({
        name: "applyAddTest",
        snapshotId: input.snapshotId,
        folderId: input.folderId,
    });
    logger.info("Applying add_test", { name: input.name });

    const updater = await TestSuiteUpdater.continueUpdateBySnapshot({
        db,
        snapshotId: input.snapshotId,
        organizationId: input.organizationId,
    });

    const { planId, testCaseId } = await updater.apply(
        new AddTest({
            name: input.name,
            plan: input.instruction,
            folderId: input.folderId,
            scenarioId: input.scenarioId,
        }),
    );
    logger.info("Test added and generation queued", { planId, testCaseId });

    await markActionApplied(input.refinementActionId);

    return { planId, testCaseId };
}
