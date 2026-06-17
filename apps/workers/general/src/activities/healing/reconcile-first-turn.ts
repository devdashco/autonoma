import { db } from "@autonoma/db";
import type { Logger } from "@autonoma/logger";
import type { RejectedCandidateDecision } from "@autonoma/workflow/activities";

/** A candidate graduated into a freshly-minted test case this turn. */
export interface AcceptedCandidateLink {
    candidateId: string;
    testCaseId: string;
}

export interface ReconcileFirstTurnOutcomesParams {
    snapshotId: string;
    /** Test case ids whose plan iteration 1 changed (update_plan), now regenerating. */
    updatedTestCaseIds: string[];
    /** Candidates the agent accepted via add_test, paired with their minted test case. */
    acceptedCandidateLinks: AcceptedCandidateLink[];
    /** Candidates the agent explicitly rejected, with reasoning. */
    rejectedCandidates: RejectedCandidateDecision[];
    logger: Logger;
}

/**
 * The first-turn apply tail. After iteration 1's healing actions are applied,
 * this performs the linking the standalone resolution step used to do, so the
 * "Resolution" snapshot stage still shows its data:
 *
 *   - Affected tests whose plan changed get their AffectedTest row linked to the
 *     queued regeneration ("Queued for regeneration").
 *   - Accepted candidates are marked accepted against their minted test case;
 *     every other candidate is rejected (explicit rejections keep their
 *     reasoning) ("Candidate decisions").
 *
 * Runs only on iteration 1. Naturally a no-op for onboarding (no AffectedTest or
 * TestCandidate rows exist) and for diffs turns with neither plan changes nor
 * candidates.
 */
export async function reconcileFirstTurnOutcomes(params: ReconcileFirstTurnOutcomesParams): Promise<void> {
    const { snapshotId, updatedTestCaseIds, acceptedCandidateLinks, rejectedCandidates, logger } = params;
    logger.info("Reconciling first-turn outcomes", {
        snapshotId,
        updatedTestCases: updatedTestCaseIds.length,
        acceptedCandidates: acceptedCandidateLinks.length,
        rejectedCandidates: rejectedCandidates.length,
    });

    await linkUpdatedTestsToGenerations(snapshotId, updatedTestCaseIds, logger);
    await markAcceptedCandidates(snapshotId, acceptedCandidateLinks, logger);
    await rejectRemainingCandidates(snapshotId, rejectedCandidates, logger);
}

/**
 * Link each updated affected test to its queued regeneration. update_plan minted
 * a fresh plan and queued exactly one generation for it; we point the
 * AffectedTest row at the latest generation for that test case in the snapshot.
 */
async function linkUpdatedTestsToGenerations(snapshotId: string, testCaseIds: string[], logger: Logger): Promise<void> {
    if (testCaseIds.length === 0) return;

    const generations = await db.testGeneration.findMany({
        where: { snapshotId, testPlan: { testCaseId: { in: testCaseIds } } },
        orderBy: { createdAt: "desc" },
        select: { id: true, testPlan: { select: { testCaseId: true } } },
    });

    const latestByTestCase = new Map<string, string>();
    for (const gen of generations) {
        if (!latestByTestCase.has(gen.testPlan.testCaseId)) latestByTestCase.set(gen.testPlan.testCaseId, gen.id);
    }

    for (const [testCaseId, generationId] of latestByTestCase) {
        await db.affectedTest
            .update({
                where: { snapshotId_testCaseId: { snapshotId, testCaseId } },
                data: { generationId },
            })
            .catch((error) => {
                logger.warn("Failed to link AffectedTest to generation", { testCaseId, generationId, error });
            });
    }
}

async function markAcceptedCandidates(
    snapshotId: string,
    accepted: AcceptedCandidateLink[],
    logger: Logger,
): Promise<void> {
    if (accepted.length === 0) {
        logger.info("No candidates accepted this turn");
        return;
    }

    for (const { candidateId, testCaseId } of accepted) {
        await db.testCandidate
            .updateMany({
                where: { id: candidateId, snapshotId },
                data: { status: "accepted", acceptedTestCaseId: testCaseId },
            })
            .catch((error) => {
                logger.warn("Failed to mark candidate accepted", { candidateId, testCaseId, error });
            });
    }
}

/**
 * Rejects every still-pending candidate. Candidates the agent explicitly rejected
 * get their reasoning persisted; any remaining pending ones (the result tool
 * forces every candidate to be decided, so this is a safety net) are bulk-rejected
 * without a reason. Runs after {@link markAcceptedCandidates}, so accepted
 * candidates are already out of the "pending" set and untouched.
 */
async function rejectRemainingCandidates(
    snapshotId: string,
    rejected: RejectedCandidateDecision[],
    logger: Logger,
): Promise<void> {
    for (const { candidateId, reasoning } of rejected) {
        await db.testCandidate
            .updateMany({
                where: { id: candidateId, snapshotId, status: "pending" },
                data: { status: "rejected", rejectionReasoning: reasoning },
            })
            .catch((error) => {
                logger.warn("Failed to persist candidate rejection reasoning", { candidateId, error });
            });
    }

    await db.testCandidate.updateMany({
        where: { snapshotId, status: "pending" },
        data: { status: "rejected" },
    });
}
