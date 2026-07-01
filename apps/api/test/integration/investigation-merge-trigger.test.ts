import { ApplicationArchitecture, type PrismaClient, TriggerSource } from "@autonoma/db";
import type { TriggerInvestigationMergeJobParams } from "@autonoma/workflow";
import { expect, vi } from "vitest";
import { InvestigationMergeTriggerService } from "../../src/investigation/investigation-merge-trigger.service";
import { apiTestSuite } from "../api-test";

const REPO_ID = 4242;

/** A main branch with an active snapshot (main's current suite) - the reconcile target. */
async function seedMainBranch(db: PrismaClient, organizationId: string, applicationId: string): Promise<string> {
    const branch = await db.branch.create({ data: { name: "main", applicationId, organizationId } });
    const snapshot = await db.branchSnapshot.create({
        data: { branchId: branch.id, status: "active", source: TriggerSource.WEBHOOK, headSha: "main-head" },
    });
    await db.branch.update({ where: { id: branch.id }, data: { activeSnapshotId: snapshot.id } });
    await db.application.update({ where: { id: applicationId }, data: { mainBranchId: branch.id } });
    return snapshot.id;
}

/**
 * A merged PR's feature branch: its active (diffs) snapshot is paired to an investigation twin. Returns the
 * twin id the trigger should resolve.
 */
async function seedMergedPrWithTwin(
    db: PrismaClient,
    organizationId: string,
    applicationId: string,
    prNumber: number,
): Promise<string> {
    const branch = await db.branch.create({
        data: {
            name: `feat-${prNumber}`,
            applicationId,
            organizationId,
            prInfo: { create: { applicationId, prNumber } },
        },
    });
    const twin = await db.branchSnapshot.create({
        data: { branchId: branch.id, status: "processing", source: TriggerSource.WEBHOOK },
    });
    const diffsSnapshot = await db.branchSnapshot.create({
        data: {
            branchId: branch.id,
            status: "active",
            source: TriggerSource.WEBHOOK,
            headSha: `head-${prNumber}`,
            investigationSnapshotId: twin.id,
        },
    });
    await db.branch.update({ where: { id: branch.id }, data: { activeSnapshotId: diffsSnapshot.id } });
    return twin.id;
}

apiTestSuite({
    name: "InvestigationMergeTriggerService",
    seed: async ({ harness }) => {
        const app = await harness.services.applications.createApplication({
            name: "Merge Trigger App",
            organizationId: harness.organizationId,
            architecture: ApplicationArchitecture.WEB,
            url: "https://example.com",
            file: "s3://bucket/file.png",
        });
        await harness.db.application.update({ where: { id: app.id }, data: { githubRepositoryId: REPO_ID } });
        const mainSnapshotId = await seedMainBranch(harness.db, harness.organizationId, app.id);
        return { applicationId: app.id, mainSnapshotId };
    },
    cases: (test) => {
        test("triggers the merge job for a merged PR that has an investigation twin", async ({
            harness,
            seedResult: { applicationId, mainSnapshotId },
        }) => {
            const twinId = await seedMergedPrWithTwin(harness.db, harness.organizationId, applicationId, 101);
            const trigger = vi.fn<(params: TriggerInvestigationMergeJobParams) => Promise<void>>().mockResolvedValue();
            const service = new InvestigationMergeTriggerService(harness.db, trigger);

            await service.onPullRequestClosed(harness.organizationId, {
                pull_request: { number: 101, merged: true },
                repository: { id: REPO_ID },
            });

            expect(trigger).toHaveBeenCalledTimes(1);
            expect(trigger).toHaveBeenCalledWith({
                twinSnapshotId: twinId,
                mainSnapshotId,
                mainBranchId: expect.any(String),
                organizationId: harness.organizationId,
            });
        });

        test("does not trigger for a closed-but-not-merged PR", async ({ harness, seedResult: { applicationId } }) => {
            await seedMergedPrWithTwin(harness.db, harness.organizationId, applicationId, 102);
            const trigger = vi.fn<(params: TriggerInvestigationMergeJobParams) => Promise<void>>().mockResolvedValue();
            const service = new InvestigationMergeTriggerService(harness.db, trigger);

            await service.onPullRequestClosed(harness.organizationId, {
                pull_request: { number: 102, merged: false },
                repository: { id: REPO_ID },
            });

            expect(trigger).not.toHaveBeenCalled();
        });

        test("does not trigger for a merged PR with no investigation twin", async ({
            harness,
            seedResult: { applicationId },
        }) => {
            const branch = await harness.db.branch.create({
                data: {
                    name: "feat-103",
                    applicationId,
                    organizationId: harness.organizationId,
                    prInfo: { create: { applicationId, prNumber: 103 } },
                },
            });
            const diffsSnapshot = await harness.db.branchSnapshot.create({
                data: { branchId: branch.id, status: "active", source: TriggerSource.WEBHOOK, headSha: "head-103" },
            });
            await harness.db.branch.update({
                where: { id: branch.id },
                data: { activeSnapshotId: diffsSnapshot.id },
            });
            const trigger = vi.fn<(params: TriggerInvestigationMergeJobParams) => Promise<void>>().mockResolvedValue();
            const service = new InvestigationMergeTriggerService(harness.db, trigger);

            await service.onPullRequestClosed(harness.organizationId, {
                pull_request: { number: 103, merged: true },
                repository: { id: REPO_ID },
            });

            expect(trigger).not.toHaveBeenCalled();
        });
    },
});
