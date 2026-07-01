import type { PrismaClient } from "@autonoma/db";
import type { TriggerInvestigationMergeJobParams } from "@autonoma/workflow";
import { z } from "zod";
import { Service } from "../routes/service";

// Only the fields the merge trigger needs, parsed defensively from the raw GitHub pull_request webhook.
const mergedPullRequestSchema = z.object({
    pull_request: z.object({
        number: z.number(),
        merged: z.boolean().optional(),
    }),
    repository: z.object({ id: z.number() }),
});

/**
 * On a merged PR, kicks off the investigation merge-with-main workflow for that PR's investigation twin: it
 * reconciles the branch twin's proposed test edits into main's current suite. Best-effort and shadow-only -
 * any failure is logged, never thrown, so it can never disturb the PR-closed webhook path. Skips silently when
 * the PR did not merge, the repo/branch is not tracked, there is no twin (shadow was off for that PR), or main
 * has no active suite to reconcile into.
 */
export class InvestigationMergeTriggerService extends Service {
    constructor(
        private readonly db: PrismaClient,
        private readonly triggerInvestigationMergeJob: (params: TriggerInvestigationMergeJobParams) => Promise<void>,
    ) {
        super();
    }

    async onPullRequestClosed(organizationId: string, payload: Record<string, unknown>): Promise<void> {
        try {
            await this.tryTriggerMerge(organizationId, payload);
        } catch (error) {
            this.logger.warn("Failed to trigger investigation merge on PR close", {
                organizationId,
                extra: { error: String(error) },
            });
        }
    }

    private async tryTriggerMerge(organizationId: string, payload: Record<string, unknown>): Promise<void> {
        const parsed = mergedPullRequestSchema.safeParse(payload);
        if (!parsed.success) {
            this.logger.warn("Investigation merge: webhook payload missing pull_request or repository", {
                organizationId,
                extra: { issues: parsed.error.issues },
            });
            return;
        }
        const { pull_request: pr, repository: repo } = parsed.data;

        // Only merges reconcile into main; a plain-closed PR abandoned its edits.
        if (pr.merged !== true) return;

        const app = await this.db.application.findFirst({
            where: { organizationId, githubRepositoryId: repo.id },
            select: {
                id: true,
                mainBranch: { select: { id: true, activeSnapshotId: true } },
            },
        });
        if (app?.mainBranch?.activeSnapshotId == null) {
            this.logger.info("Investigation merge: no linked app or main active suite; skipping", {
                organizationId,
                extra: { repoId: repo.id, prNumber: pr.number },
            });
            return;
        }

        // The merged PR's branch: its active (diffs) snapshot is paired to the investigation twin holding the edits.
        const featureBranch = await this.db.featureBranchInfo.findUnique({
            where: { applicationId_prNumber: { applicationId: app.id, prNumber: pr.number } },
            select: { branch: { select: { activeSnapshot: { select: { investigationSnapshotId: true } } } } },
        });
        const twinSnapshotId = featureBranch?.branch.activeSnapshot?.investigationSnapshotId;
        if (twinSnapshotId == null) {
            this.logger.info("Investigation merge: merged PR has no investigation twin; skipping", {
                organizationId,
                extra: { prNumber: pr.number },
            });
            return;
        }

        this.logger.info("Triggering investigation merge for merged PR", {
            organizationId,
            snapshot: { snapshotId: twinSnapshotId },
            extra: { prNumber: pr.number },
        });
        await this.triggerInvestigationMergeJob({
            twinSnapshotId,
            mainSnapshotId: app.mainBranch.activeSnapshotId,
            mainBranchId: app.mainBranch.id,
            organizationId,
        });
    }
}
