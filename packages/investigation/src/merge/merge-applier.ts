import type { PrismaClient } from "@autonoma/db";
import { type Logger, logger as rootLogger } from "@autonoma/logger";
import { createDetachedSnapshot } from "@autonoma/test-updates";
import {
    EditPersister,
    type NewTestProposal,
    type PersistEditsResult,
    type TestModification,
} from "../persist/edit-persister";
import type { BranchEdit } from "./merge-inputs";
import type { MergePlan } from "./schema";

export interface MergeApplyResult {
    /**
     * The detached snapshot cloned from main's active suite with the accepted edits applied - investigation's
     * PROPOSED main suite. Never wired to the main branch pointer, so the real (diffs) suite is untouched.
     * Undefined when nothing was accepted (no snapshot is created for an empty merge).
     */
    mainProposalSnapshotId?: string;
    persist?: PersistEditsResult;
    appliedCount: number;
    skippedCount: number;
}

/**
 * Applies a reconciled merge plan onto a FRESH detached snapshot cloned from main's current active suite. The
 * accepted decisions become modifications / new tests on that snapshot via the shared `EditPersister`;
 * skipped decisions are dropped (their reasons live in the plan for the report). Cloning from main each merge
 * is what makes this self-healing - it always reconciles against ground-truth main, never a drifting copy.
 */
export class MergeApplier {
    private readonly logger: Logger;

    constructor(private readonly db: PrismaClient) {
        this.logger = rootLogger.child({ name: this.constructor.name });
    }

    async apply(
        edits: BranchEdit[],
        plan: MergePlan,
        mainBranchId: string,
        organizationId: string,
    ): Promise<MergeApplyResult> {
        const editByKey = new Map(edits.map((edit) => [`${edit.kind}:${edit.ref}`, edit]));
        const accepted = plan.decisions.filter((decision) => decision.action === "apply");
        const skippedCount = plan.decisions.length - accepted.length;

        this.logger.info("Applying merge plan to a detached main snapshot", {
            extra: { accepted: accepted.length, skipped: skippedCount, mainBranchId },
        });

        const modifications: TestModification[] = [];
        const newTests: NewTestProposal[] = [];
        for (const decision of accepted) {
            const edit = editByKey.get(`${decision.kind}:${decision.ref}`);
            if (edit == null) {
                this.logger.warn("Accepted decision has no matching edit; skipping", {
                    extra: { kind: decision.kind, ref: decision.ref },
                });
                continue;
            }
            const planText = decision.mergedPlan ?? edit.proposedPlan;
            if (decision.kind === "modification") {
                modifications.push({ slug: edit.ref, plan: planText });
            } else {
                newTests.push({ name: edit.name, description: edit.description, plan: planText });
            }
        }

        if (modifications.length === 0 && newTests.length === 0) {
            this.logger.info("No accepted edits to apply; skipping main proposal snapshot");
            return { appliedCount: 0, skippedCount };
        }

        const created = await createDetachedSnapshot({ db: this.db, branchId: mainBranchId, organizationId });
        if (created == null) {
            this.logger.warn("Main branch has no baseline suite to fork; cannot apply merge plan", {
                extra: { mainBranchId },
            });
            return { appliedCount: 0, skippedCount };
        }

        const persist = await new EditPersister(this.db).persist(
            created.snapshotId,
            organizationId,
            modifications,
            newTests,
        );

        this.logger.info("Merge plan applied to main proposal snapshot", {
            snapshot: { snapshotId: created.snapshotId },
            extra: { persisted: persist.persisted.length, skipped: persist.skipped.length },
        });
        return {
            mainProposalSnapshotId: created.snapshotId,
            persist,
            appliedCount: persist.persisted.length,
            skippedCount,
        };
    }
}
