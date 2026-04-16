import { ApplicationArchitecture } from "@autonoma/db";
import { NotFoundError } from "@autonoma/errors";
import { expect } from "vitest";
import { apiTestSuite } from "../api-test";

apiTestSuite({
    name: "GitHubInstallationService",
    seed: async ({ harness }) => {
        const fakeClient = harness.githubApp.defaultClient;

        const app = await harness.services.applications.createApplication({
            name: "Test App",
            organizationId: harness.organizationId,
            architecture: ApplicationArchitecture.WEB,
            url: "https://example.com",
            file: "s3://bucket/file.png",
        });

        return { app, fakeClient };
    },
    cases: (test) => {
        test("handleInstallation upserts installation", async ({ harness }) => {
            await harness.services.github.handleInstallation(
                12345,
                harness.organizationId,
                "test-org",
                999,
                "Organization",
            );

            const installation = await harness.db.gitHubInstallation.findUnique({
                where: { organizationId: harness.organizationId },
            });

            expect(installation).not.toBeNull();
            expect(installation!.installationId).toBe(12345);
            expect(installation!.accountLogin).toBe("test-org");
            expect(installation!.status).toBe("active");
        });

        test("handleInstallation updates existing installation on re-install", async ({ harness }) => {
            await harness.services.github.handleInstallation(
                12345,
                harness.organizationId,
                "test-org",
                999,
                "Organization",
            );

            await harness.services.github.handleInstallation(
                12345,
                harness.organizationId,
                "new-org-name",
                999,
                "Organization",
            );

            const installation = await harness.db.gitHubInstallation.findUnique({
                where: { organizationId: harness.organizationId },
            });

            expect(installation!.accountLogin).toBe("new-org-name");
        });

        test("handleUninstall marks installation as deleted", async ({ harness }) => {
            await harness.services.github.handleInstallation(
                55555,
                harness.organizationId,
                "test-org",
                999,
                "Organization",
            );

            await harness.services.github.handleUninstall(55555);

            const installation = await harness.db.gitHubInstallation.findUnique({
                where: { organizationId: harness.organizationId },
            });

            expect(installation!.status).toBe("deleted");
        });

        test("handleSuspend marks installation as suspended", async ({ harness }) => {
            await harness.services.github.handleInstallation(
                66666,
                harness.organizationId,
                "test-org",
                999,
                "Organization",
            );

            await harness.services.github.handleSuspend(66666);

            const installation = await harness.db.gitHubInstallation.findUnique({
                where: { organizationId: harness.organizationId },
            });

            expect(installation!.status).toBe("suspended");
        });

        test("listRepositories returns repos from GitHub API with linked app info", async ({
            harness,
            seedResult: { app, fakeClient },
        }) => {
            fakeClient.addRepository({
                id: 2001,
                name: "my-repo",
                fullName: "org/my-repo",
                defaultBranch: "main",
                private: false,
            });
            fakeClient.addRepository({
                id: 2002,
                name: "other-repo",
                fullName: "org/other-repo",
                defaultBranch: "main",
                private: false,
            });

            await harness.services.github.handleInstallation(
                77777,
                harness.organizationId,
                "test-org",
                999,
                "Organization",
            );

            // Link app to first repo
            await harness.db.application.update({
                where: { id: app.id },
                data: { githubRepositoryId: 2001 },
            });

            const repos = await harness.services.github.listRepositories(harness.organizationId);
            expect(repos).toHaveLength(2);

            const linkedRepo = repos.find((r) => r.id === 2001);
            expect(linkedRepo?.applicationId).toBe(app.id);

            const unlinkedRepo = repos.find((r) => r.id === 2002);
            expect(unlinkedRepo?.applicationId).toBeUndefined();
        });

        test("listRepositories throws NotFoundError when no installation", async ({ harness }) => {
            await expect(harness.services.github.listRepositories("nonexistent-org-id")).rejects.toThrow(NotFoundError);
        });

        test("linkRepository sets githubRepositoryId on application", async ({
            harness,
            seedResult: { app, fakeClient },
        }) => {
            fakeClient.addRepository({
                id: 3001,
                name: "config-repo",
                fullName: "org/config-repo",
                defaultBranch: "main",
                private: false,
            });

            await harness.services.github.handleInstallation(
                88888,
                harness.organizationId,
                "test-org",
                999,
                "Organization",
            );

            await harness.services.github.linkRepository(harness.organizationId, app.id, 3001);

            const updated = await harness.db.application.findUnique({ where: { id: app.id } });
            expect(updated!.githubRepositoryId).toBe(3001);
        });

        test("linkRepository throws NotFoundError for nonexistent app", async ({ harness }) => {
            await harness.services.github.handleInstallation(
                99999,
                harness.organizationId,
                "test-org",
                999,
                "Organization",
            );

            await expect(
                harness.services.github.linkRepository(harness.organizationId, "nonexistent-app-id", 1234),
            ).rejects.toThrow(NotFoundError);
        });

        test("disconnect removes installation and clears githubRepositoryId", async ({
            harness,
            seedResult: { app },
        }) => {
            await harness.services.github.handleInstallation(
                11111,
                harness.organizationId,
                "test-org",
                999,
                "Organization",
            );

            await harness.db.application.update({
                where: { id: app.id },
                data: { githubRepositoryId: 5001 },
            });

            await harness.services.github.disconnect(harness.organizationId);

            const installation = await harness.db.gitHubInstallation.findUnique({
                where: { organizationId: harness.organizationId },
            });
            expect(installation).toBeNull();

            const updatedApp = await harness.db.application.findUnique({ where: { id: app.id } });
            expect(updatedApp!.githubRepositoryId).toBeNull();
        });

        test("disconnect throws NotFoundError when no installation", async ({ harness }) => {
            await expect(harness.services.github.disconnect("nonexistent-org-id")).rejects.toThrow(NotFoundError);
        });

        test("handleBranchDeployment creates branch and deployment", async ({ harness, seedResult: { app } }) => {
            await harness.services.github.handleInstallation(
                44444,
                harness.organizationId,
                "test-org",
                999,
                "Organization",
            );

            // Link the app to a repo
            await harness.db.application.update({
                where: { id: app.id },
                data: { githubRepositoryId: 5001 },
            });

            const result = await harness.services.github.handleBranchDeployment(
                harness.organizationId,
                5001,
                "refs/heads/feature/my-branch",
                "sha123",
                "https://preview.example.com",
                "preview",
                42,
            );

            expect(result.branchId).toBeDefined();
            expect(result.deploymentId).toBeDefined();

            const branch = await harness.db.branch.findUnique({ where: { id: result.branchId } });
            expect(branch).not.toBeNull();
            expect(branch!.githubRef).toBe("feature/my-branch");
            expect(branch!.applicationId).toBe(app.id);
        });

        test("handleBranchDeployment reuses existing branch", async ({ harness, seedResult: { app } }) => {
            await harness.services.github.handleInstallation(
                55556,
                harness.organizationId,
                "test-org",
                999,
                "Organization",
            );

            await harness.db.application.update({
                where: { id: app.id },
                data: { githubRepositoryId: 6001 },
            });

            const first = await harness.services.github.handleBranchDeployment(
                harness.organizationId,
                6001,
                "my-branch",
                "sha1",
                "https://v1.example.com",
                undefined,
                99,
            );

            const second = await harness.services.github.handleBranchDeployment(
                harness.organizationId,
                6001,
                "my-branch",
                "sha2",
                "https://v2.example.com",
                undefined,
                99,
            );

            expect(first.branchId).toBe(second.branchId);
            expect(first.deploymentId).not.toBe(second.deploymentId);
        });

        test("handleBranchDeployment throws when no app linked to repo", async ({ harness }) => {
            await harness.services.github.handleInstallation(
                66667,
                harness.organizationId,
                "test-org",
                999,
                "Organization",
            );

            await expect(
                harness.services.github.handleBranchDeployment(
                    harness.organizationId,
                    7001,
                    "main",
                    "sha123",
                    "https://example.com",
                    undefined,
                    1,
                ),
            ).rejects.toThrow("No application linked to GitHub repository");
        });
    },
});
