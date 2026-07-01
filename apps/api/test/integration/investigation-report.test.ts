import { ApplicationArchitecture } from "@autonoma/db";
import { expect } from "vitest";
import { apiTestSuite } from "../api-test";

apiTestSuite({
    name: "investigation report",
    seed: async ({ harness }) => {
        const application = await harness.services.applications.createApplication({
            name: "Report App",
            organizationId: harness.organizationId,
            architecture: ApplicationArchitecture.WEB,
            url: "https://example.com",
            file: "s3://bucket/default-file.png",
        });
        const branch = await harness.db.branch.create({
            data: { name: "feature/report", applicationId: application.id, organizationId: harness.organizationId },
        });
        return { application, branch };
    },
    cases: (test) => {
        // Each case makes its own PR snapshot: the suites share one DB with no per-test truncation, so a shared
        // snapshot would leak an InvestigationReport from one case into another's "no report" assertion.
        test("resolves a legacy report keyed directly to the PR snapshot (pre-#1204)", async ({
            harness,
            seedResult: { branch },
        }) => {
            const prSnapshot = await harness.db.branchSnapshot.create({
                data: { branchId: branch.id, source: "GITHUB_PUSH", headSha: "legacy-sha" },
            });
            await harness.db.investigationReport.create({
                data: {
                    snapshotId: prSnapshot.id,
                    organizationId: harness.organizationId,
                    s3Key: "investigation/report-app/legacy.md",
                    testCount: 3,
                    clientBugCount: 1,
                },
            });

            const report = await harness.services.branches.getInvestigationReport(
                prSnapshot.id,
                harness.organizationId,
            );
            expect(report).not.toBeUndefined();
            expect(report?.testCount).toBe(3);
            expect(report?.clientBugCount).toBe(1);
        });

        test("resolves a twin report via the investigationParent FK (post-#1204)", async ({
            harness,
            seedResult: { branch },
        }) => {
            const prSnapshot = await harness.db.branchSnapshot.create({
                data: { branchId: branch.id, source: "GITHUB_PUSH", headSha: "twin-sha" },
            });
            const twin = await harness.db.branchSnapshot.create({
                data: { branchId: branch.id, source: "GITHUB_PUSH" },
            });
            await harness.db.branchSnapshot.update({
                where: { id: prSnapshot.id },
                data: { investigationSnapshotId: twin.id },
            });
            await harness.db.investigationReport.create({
                data: {
                    snapshotId: twin.id,
                    organizationId: harness.organizationId,
                    s3Key: "investigation/report-app/twin.md",
                    testCount: 5,
                    clientBugCount: 0,
                },
            });

            const report = await harness.services.branches.getInvestigationReport(
                prSnapshot.id,
                harness.organizationId,
            );
            expect(report?.testCount).toBe(5);
        });

        test("returns undefined when no report exists for the snapshot", async ({
            harness,
            seedResult: { branch },
        }) => {
            const prSnapshot = await harness.db.branchSnapshot.create({
                data: { branchId: branch.id, source: "GITHUB_PUSH", headSha: "none-sha" },
            });
            const report = await harness.services.branches.getInvestigationReport(
                prSnapshot.id,
                harness.organizationId,
            );
            expect(report).toBeUndefined();
        });
    },
});
