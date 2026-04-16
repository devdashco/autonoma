import type { PrismaClient } from "@autonoma/db";
import { TriggerSource } from "@autonoma/db";
import { NotFoundError } from "@autonoma/errors";
import { BranchAlreadyHasPendingSnapshotError, SnapshotDraft, TestSuiteUpdater } from "@autonoma/test-updates";
import type { TriggerDiffsJobParams } from "@autonoma/workflow";
import type { GitHubInstallationService } from "../github/github-installation.service";
import { Service } from "../routes/service";

export interface TriggerDiffsParams {
    organizationId: string;
    repoId: number;
    prNumber: number;
    url: string;
    environment?: string;
}

export interface TriggerDiffsResult {
    branchId: string;
    snapshotId: string;
    deploymentId: string;
}

export class DiffsTriggerService extends Service {
    constructor(
        private readonly db: PrismaClient,
        private readonly githubInstallationService: GitHubInstallationService,
        private readonly triggerDiffsJob: (params: TriggerDiffsJobParams) => Promise<void>,
        private readonly cancelDiffsJob: (branchId: string) => Promise<void>,
    ) {
        super();
    }

    async triggerDiffs(params: TriggerDiffsParams): Promise<TriggerDiffsResult> {
        const { organizationId, repoId, prNumber, url, environment } = params;

        this.logger.info("Triggering diffs analysis", { organizationId, repoId, prNumber });

        const app = await this.db.application.findFirst({
            where: {
                organizationId,
                githubRepositoryId: repoId,
            },
            select: { id: true },
        });

        if (app == null) {
            throw new NotFoundError(`No application linked to repository ${repoId}`);
        }

        const pullRequest = await this.githubInstallationService.getPullRequest(organizationId, repoId, prNumber);
        const normalizedBranch = pullRequest.headRef;
        const headSha = pullRequest.headSha;

        const branch = await this.findOrCreateBranch(app.id, organizationId, normalizedBranch, prNumber);
        const baseSha = branch.lastHandledSha ?? pullRequest.baseSha;

        this.logger.info("Resolved branch and shas", { branchId: branch.id, headSha, baseSha });

        const { deploymentId } = await this.githubInstallationService.handleBranchDeployment(
            organizationId,
            repoId,
            normalizedBranch,
            headSha,
            url,
            environment,
            prNumber,
        );

        const snapshotId = await this.createSnapshot(branch.id, organizationId, headSha, baseSha, deploymentId);

        await this.triggerDiffsJob({ branchId: branch.id });

        this.logger.info("Diffs analysis triggered successfully", {
            branchId: branch.id,
            snapshotId,
            deploymentId,
            headSha,
            baseSha,
        });

        return { branchId: branch.id, snapshotId, deploymentId };
    }

    private async findOrCreateBranch(
        applicationId: string,
        organizationId: string,
        normalizedBranch: string,
        prNumber: number,
    ) {
        return this.db.$transaction(async (tx) => {
            let branch = await tx.branch.findUnique({
                where: {
                    applicationId_prNumber: { applicationId, prNumber },
                },
                select: { id: true, lastHandledSha: true, prNumber: true },
            });

            if (branch == null) {
                this.logger.info("Auto-creating branch", { applicationId, branch: normalizedBranch, prNumber });
                branch = await tx.branch.create({
                    data: {
                        name: normalizedBranch,
                        githubRef: normalizedBranch,
                        prNumber,
                        applicationId,
                        organizationId,
                    },
                    select: { id: true, lastHandledSha: true, prNumber: true },
                });
            }

            return branch;
        });
    }

    private async createSnapshot(
        branchId: string,
        organizationId: string,
        headSha: string,
        baseSha: string,
        deploymentId: string,
    ): Promise<string> {
        try {
            const updater = await TestSuiteUpdater.startUpdate({
                db: this.db,
                branchId,
                organizationId,
                source: TriggerSource.WEBHOOK,
                headSha,
                baseSha,
                deploymentId,
            });
            return updater.snapshotId;
        } catch (error) {
            if (!(error instanceof BranchAlreadyHasPendingSnapshotError)) throw error;

            this.logger.info("Cancelling existing diffs job and discarding pending snapshot", { branchId });

            await this.cancelDiffsJob(branchId);

            const staleSnapshot = await SnapshotDraft.loadPending({ db: this.db, branchId });
            await staleSnapshot.discard();

            this.logger.info("Stale snapshot discarded, starting fresh update", { branchId });

            const updater = await TestSuiteUpdater.startUpdate({
                db: this.db,
                branchId,
                organizationId,
                source: TriggerSource.WEBHOOK,
                headSha,
                baseSha,
                deploymentId,
            });
            return updater.snapshotId;
        }
    }
}
