import { db } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import { markActionApplied } from "./mark-applied";
import type { ApplyReportEngineLimitationInput } from "./types";

/**
 * Atomic: creates an Issue with kind=engine_limitation scoped to the snapshot,
 * and quarantines the test case for this snapshot.
 */
export async function applyReportEngineLimitation(input: ApplyReportEngineLimitationInput): Promise<void> {
    const logger = rootLogger.child({
        name: "applyReportEngineLimitation",
        snapshotId: input.snapshotId,
        testCaseId: input.testCaseId,
    });
    logger.info("Applying report_engine_limitation");

    await db.$transaction(async (tx) => {
        const issue = await tx.issue.create({
            data: {
                ...input.reviewLink,
                kind: "engine_limitation",
                severity: input.severity,
                title: input.title,
                description: input.description,
                snapshotId: input.snapshotId,
                organizationId: input.organizationId,
            },
            select: { id: true },
        });

        await tx.testCaseQuarantine.create({
            data: {
                snapshotId: input.snapshotId,
                testCaseId: input.testCaseId,
                reason: "engine_limitation",
                issueId: issue.id,
                organizationId: input.organizationId,
            },
        });
    });

    await markActionApplied(input.refinementActionId);
    logger.info("report_engine_limitation applied");
}
