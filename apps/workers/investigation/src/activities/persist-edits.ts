import { db } from "@autonoma/db";
import { EditPersister } from "@autonoma/investigation";
import { logger as rootLogger } from "@autonoma/logger";
import type { PersistInvestigationEditsInput, PersistInvestigationEditsOutput } from "@autonoma/workflow/activities";

/**
 * Persist the investigation agent's add/modify/remove edits onto its (detached) snapshot: a proposed suite that
 * the merge-with-main step later reconciles into main. It writes only to the twin - never activating it, never
 * touching the diffs suite. Add/modify always run; `removals` is only populated by the caller for orgs that
 * opted into the agent acting (a deletion is harder to walk back than an added/edited plan), so it is gated
 * upstream by the same autofix flag as recipe/test-fix writes.
 */
export async function persistInvestigationEdits(
    input: PersistInvestigationEditsInput,
): Promise<PersistInvestigationEditsOutput> {
    const { snapshotId, modifications, newTests, removals } = input;
    const logger = rootLogger.child({ name: "persistInvestigationEdits", extra: { snapshotId } });
    logger.info("Persisting investigation edits", {
        extra: { modifications: modifications.length, newTests: newTests.length, removals: removals.length },
    });

    // Only the organizationId is needed to scope the writes - resolve it directly instead of pulling a full
    // SnapshotMeta (which does a live GitHub getRepository round-trip that would be pure overhead here).
    const snapshot = await db.branchSnapshot.findUnique({
        where: { id: snapshotId },
        select: { branch: { select: { organizationId: true } } },
    });
    if (snapshot == null) throw new Error(`Snapshot ${snapshotId} not found`);

    const result = await new EditPersister(db).persist(
        snapshotId,
        snapshot.branch.organizationId,
        modifications,
        newTests,
        removals,
    );

    logger.info("Persisted investigation edits", {
        extra: { persisted: result.persisted.length, skipped: result.skipped.length },
    });
    return { persistedCount: result.persisted.length, skipped: result.skipped };
}
