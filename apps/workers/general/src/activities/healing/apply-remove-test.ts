import { db } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import { markActionApplied } from "./mark-applied";
import type { ApplyRemoveTestInput } from "./types";

/**
 * Suite-level removal: drops the TestCaseAssignment for this snapshot. The
 * underlying TestCase row is preserved (other snapshots may still reference
 * it through history); only its membership in the current snapshot is
 * revoked.
 */
export async function applyRemoveTest(input: ApplyRemoveTestInput): Promise<void> {
    const logger = rootLogger.child({
        name: "applyRemoveTest",
        snapshotId: input.snapshotId,
        testCaseId: input.testCaseId,
    });
    logger.info("Applying remove_test");

    await db.testCaseAssignment.delete({
        where: { snapshotId_testCaseId: { snapshotId: input.snapshotId, testCaseId: input.testCaseId } },
    });

    await markActionApplied(input.refinementActionId);
    logger.info("remove_test applied");
}
