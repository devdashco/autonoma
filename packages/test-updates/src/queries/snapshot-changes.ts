import type { PrismaClient } from "@autonoma/db";
import { type Logger, logger as rootLogger } from "@autonoma/logger";

interface BaseChange {
    testCaseId: string;
    testCaseName: string;
    testCaseSlug: string;
}

interface AddedChange extends BaseChange {
    type: "added";
    plan: string;
}

interface RemovedChange extends BaseChange {
    type: "removed";
    previousPlan: string;
}

interface UpdatedChange extends BaseChange {
    type: "updated";
    plan: string;
    previousPlan: string;
}

export type SnapshotChange = AddedChange | RemovedChange | UpdatedChange;

const assignmentSelect = {
    testCaseId: true,
    planId: true,
    testCase: { select: { id: true, name: true, slug: true } },
    plan: { select: { prompt: true } },
} as const;

/**
 * Computes the list of test-case changes for a snapshot relative to its previous snapshot.
 *
 * Present in snapshot but not previous -> "added"
 * Present in previous but not snapshot -> "removed"
 * Present in both but planId differs  -> "updated"
 * Same planId in both                 -> unchanged (omitted)
 *
 * If the snapshot has no previous snapshot, every assignment is reported as "added".
 */
export async function computeSnapshotChanges(
    db: PrismaClient,
    snapshotId: string,
    parentLogger?: Logger,
): Promise<SnapshotChange[]> {
    const logger = (parentLogger ?? rootLogger).child({ name: "computeSnapshotChanges", snapshotId });
    logger.info("Computing snapshot changes");

    const snapshot = await db.branchSnapshot.findUniqueOrThrow({
        where: { id: snapshotId },
        select: { prevSnapshotId: true },
    });

    const pendingAssignments = await db.testCaseAssignment.findMany({
        where: { snapshotId },
        select: assignmentSelect,
    });

    if (snapshot.prevSnapshotId == null) {
        logger.info("No previous snapshot, all assignments are additions", {
            count: pendingAssignments.length,
        });
        return pendingAssignments.map((a) => ({
            type: "added" as const,
            testCaseId: a.testCase.id,
            testCaseName: a.testCase.name,
            testCaseSlug: a.testCase.slug,
            plan: a.plan?.prompt ?? "",
        }));
    }

    const previousAssignments = await db.testCaseAssignment.findMany({
        where: { snapshotId: snapshot.prevSnapshotId },
        select: assignmentSelect,
    });

    const previousByTestCaseId = new Map(previousAssignments.map((a) => [a.testCaseId, a]));
    const pendingByTestCaseId = new Map(pendingAssignments.map((a) => [a.testCaseId, a]));

    const changes: SnapshotChange[] = [];

    for (const [testCaseId, pending] of pendingByTestCaseId) {
        const previous = previousByTestCaseId.get(testCaseId);

        if (previous == null) {
            changes.push({
                type: "added",
                testCaseId: pending.testCase.id,
                testCaseName: pending.testCase.name,
                testCaseSlug: pending.testCase.slug,
                plan: pending.plan?.prompt ?? "",
            });
        } else if (pending.planId !== previous.planId) {
            changes.push({
                type: "updated",
                testCaseId: pending.testCase.id,
                testCaseName: pending.testCase.name,
                testCaseSlug: pending.testCase.slug,
                plan: pending.plan?.prompt ?? "",
                previousPlan: previous.plan?.prompt ?? "",
            });
        }
    }

    for (const [testCaseId, previous] of previousByTestCaseId) {
        if (!pendingByTestCaseId.has(testCaseId)) {
            changes.push({
                type: "removed",
                testCaseId: previous.testCase.id,
                testCaseName: previous.testCase.name,
                testCaseSlug: previous.testCase.slug,
                previousPlan: previous.plan?.prompt ?? "",
            });
        }
    }

    logger.info("Changes computed", { count: changes.length });

    return changes;
}

export interface SnapshotChangeSummary {
    added: number;
    removed: number;
    updated: number;
}

/** Returns counts of added/removed/updated test cases for the given snapshot. */
export async function summarizeSnapshotChanges(
    db: PrismaClient,
    snapshotId: string,
    parentLogger?: Logger,
): Promise<SnapshotChangeSummary> {
    const changes = await computeSnapshotChanges(db, snapshotId, parentLogger);
    return {
        added: changes.filter((c) => c.type === "added").length,
        removed: changes.filter((c) => c.type === "removed").length,
        updated: changes.filter((c) => c.type === "updated").length,
    };
}
