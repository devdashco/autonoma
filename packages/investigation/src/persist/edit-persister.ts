import type { PrismaClient } from "@autonoma/db";
import { type Logger, logger as rootLogger } from "@autonoma/logger";
import { SnapshotDraft } from "@autonoma/test-updates";

/** A modification to an existing test on the snapshot: its slug + the full revised plan to pin. */
export interface TestModification {
    slug: string;
    plan: string;
}

/** A brand-new test to add to the snapshot: name, a one-line falsifiable description, and the full plan. */
export interface NewTestProposal {
    name: string;
    description: string;
    plan: string;
}

/** One edit that was written to the snapshot. */
export interface PersistedEdit {
    kind: "modified" | "added";
    /** The existing test's slug (modifications) or the new test's name (additions). */
    ref: string;
    testCaseId: string;
    planId: string;
}

/** One edit that could not be written, with the reason (surfaced in the report, never thrown). */
export interface SkippedEdit {
    kind: "modification" | "new_test";
    ref: string;
    reason: string;
}

export interface PersistEditsResult {
    persisted: PersistedEdit[];
    skipped: SkippedEdit[];
}

/**
 * The folder proposed new tests land in for now. A later pass reorganizes them into the app's real flows;
 * keeping them in one clearly-named folder makes investigation-authored tests easy to find until then.
 */
const INVESTIGATION_FOLDER_NAME = "Investigation";

/**
 * Persists the investigation agent's proposed test edits onto its (detached) snapshot: repoints existing
 * tests to a revised plan and adds proposed new tests. Writes ONLY to the given snapshot's
 * `TestCaseAssignment` set and never activates it, so the branch's active (diffs) suite is untouched - the
 * edits live on the investigation twin as a proposed suite that the merge-with-main step later reconciles
 * into main. Persist-only: it does not queue generations (running is the cumulative-running phase's job).
 */
export class EditPersister {
    private readonly logger: Logger;

    constructor(private readonly db: PrismaClient) {
        this.logger = rootLogger.child({ name: this.constructor.name });
    }

    /**
     * Apply the modifications and new tests to `snapshotId`. A single edit that cannot be applied (e.g. a
     * modification whose test is not assigned to the snapshot) is recorded in `skipped`, never thrown, so one
     * bad edit never sinks the rest.
     */
    async persist(
        snapshotId: string,
        organizationId: string,
        modifications: TestModification[],
        newTests: NewTestProposal[],
    ): Promise<PersistEditsResult> {
        this.logger.info("Persisting investigation test edits", {
            snapshot: { snapshotId },
            extra: { modifications: modifications.length, newTests: newTests.length },
        });

        const draft = await SnapshotDraft.loadById({ db: this.db, snapshotId, organizationId });
        const persisted: PersistedEdit[] = [];
        const skipped: SkippedEdit[] = [];

        for (const modification of modifications) {
            await this.applyModification(draft, snapshotId, modification, persisted, skipped);
        }

        if (newTests.length > 0) {
            const folderId = await this.resolveInvestigationFolder(draft.applicationId, organizationId);
            for (const newTest of newTests) {
                const { testCaseId, planId } = await draft.addTestCase({
                    name: newTest.name,
                    description: newTest.description,
                    plan: newTest.plan,
                    folderId,
                });
                persisted.push({ kind: "added", ref: newTest.name, testCaseId, planId });
            }
        }

        this.logger.info("Persisted investigation test edits", {
            snapshot: { snapshotId },
            extra: { persisted: persisted.length, skipped: skipped.length },
        });
        return { persisted, skipped };
    }

    private async applyModification(
        draft: SnapshotDraft,
        snapshotId: string,
        modification: TestModification,
        persisted: PersistedEdit[],
        skipped: SkippedEdit[],
    ): Promise<void> {
        const assignment = await this.db.testCaseAssignment.findFirst({
            where: { snapshotId, testCase: { slug: modification.slug } },
            select: { testCaseId: true, plan: { select: { scenarioId: true } } },
        });

        if (assignment == null) {
            this.logger.warn("Skipping modification - test not assigned to snapshot", {
                snapshot: { snapshotId },
                extra: { slug: modification.slug },
            });
            skipped.push({ kind: "modification", ref: modification.slug, reason: "test not assigned to snapshot" });
            return;
        }

        // Preserve the test's pinned scenario - a modification only changes the plan text, not the data setup.
        const { planId } = await draft.updatePlan({
            testCaseId: assignment.testCaseId,
            plan: modification.plan,
            scenarioId: assignment.plan?.scenarioId ?? undefined,
        });
        persisted.push({ kind: "modified", ref: modification.slug, testCaseId: assignment.testCaseId, planId });
    }

    /** Find-or-create the folder investigation-authored tests are grouped under for this application. */
    private async resolveInvestigationFolder(applicationId: string, organizationId: string): Promise<string> {
        const existing = await this.db.folder.findFirst({
            where: { applicationId, name: INVESTIGATION_FOLDER_NAME },
            select: { id: true },
        });
        if (existing != null) return existing.id;

        const created = await this.db.folder.create({
            data: { name: INVESTIGATION_FOLDER_NAME, applicationId, organizationId },
            select: { id: true },
        });
        this.logger.info("Created investigation folder", { extra: { applicationId, folderId: created.id } });
        return created.id;
    }
}
