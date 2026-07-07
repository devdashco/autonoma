import { ApplicationArchitecture } from "@autonoma/db";
import { expect } from "vitest";
import { apiTestSuite } from "../api-test";

apiTestSuite({
    name: "runs",
    seed: async ({ harness }) => {
        const application = await harness.services.applications.createApplication({
            name: "My Web App",
            organizationId: harness.organizationId,
            architecture: ApplicationArchitecture.WEB,
            url: "https://example.com",
            file: "s3://bucket/default-file.png",
        });

        const mainBranch = await harness.db.branch.findFirstOrThrow({
            where: { applicationId: application.id },
            select: { activeSnapshotId: true },
        });

        // biome-ignore lint/style/noNonNullAssertion: `applications.createApplication` adds an active snapshot
        const snapshotId = mainBranch.activeSnapshotId!;

        const folder = await harness.db.folder.create({
            data: {
                name: "Default",
                applicationId: application.id,
                organizationId: harness.organizationId,
            },
        });

        const testCase = await harness.db.testCase.create({
            data: {
                name: "Login flow test",
                slug: "login-flow-test",
                applicationId: application.id,
                organizationId: harness.organizationId,
                folderId: folder.id,
            },
        });

        const testPlan = await harness.db.testPlan.create({
            data: {
                prompt: "Navigate to login, enter credentials, assert dashboard is visible",
                testCaseId: testCase.id,
                organizationId: harness.organizationId,
            },
        });

        const stepInputList = await harness.db.stepInputList.create({
            data: { planId: testPlan.id, organizationId: harness.organizationId },
        });

        const si0 = await harness.db.stepInput.create({
            data: {
                listId: stepInputList.id,
                order: 0,
                interaction: "navigate",
                params: { url: "https://example.com/login" },
                organizationId: harness.organizationId,
            },
        });

        const si1 = await harness.db.stepInput.create({
            data: {
                listId: stepInputList.id,
                order: 1,
                interaction: "click",
                params: { description: "Sign in button" },
                organizationId: harness.organizationId,
            },
        });

        const stepOutputList = await harness.db.stepOutputList.create({
            data: { organizationId: harness.organizationId },
        });

        await harness.db.stepOutput.create({
            data: {
                listId: stepOutputList.id,
                order: 0,
                output: { outcome: "navigated successfully" },
                stepInputId: si0.id,
                organizationId: harness.organizationId,
            },
        });

        await harness.db.stepOutput.create({
            data: {
                listId: stepOutputList.id,
                order: 1,
                output: { outcome: "clicked sign in button" },
                stepInputId: si1.id,
                organizationId: harness.organizationId,
            },
        });

        // Generation with steps - simulates a completed test generation
        await harness.db.testGeneration.create({
            data: {
                testPlanId: testPlan.id,
                snapshotId,
                organizationId: harness.organizationId,
                status: "success",
                stepsId: stepInputList.id,
                outputsId: stepOutputList.id,
            },
        });

        // Assignment with stepsId already set - ready for replay
        const assignment = await harness.db.testCaseAssignment.create({
            data: {
                testCaseId: testCase.id,
                snapshotId,
                planId: testPlan.id,
                stepsId: stepInputList.id,
            },
        });

        // A test case with no steps - to test error path
        const testCaseNoSteps = await harness.db.testCase.create({
            data: {
                name: "Ungenerated test",
                slug: "ungenerated-test",
                applicationId: application.id,
                organizationId: harness.organizationId,
                folderId: folder.id,
            },
        });

        const testPlanNoSteps = await harness.db.testPlan.create({
            data: {
                prompt: "A test with no generation yet",
                testCaseId: testCaseNoSteps.id,
                organizationId: harness.organizationId,
            },
        });

        await harness.db.testCaseAssignment.create({
            data: {
                testCaseId: testCaseNoSteps.id,
                snapshotId,
                planId: testPlanNoSteps.id,
            },
        });

        return { application, testCase, assignment, stepOutputList, si0, si1, testCaseNoSteps, snapshotId };
    },
    cases: (test) => {
        test("list returns all runs for the organization", async ({ harness, seedResult: { assignment } }) => {
            await harness.db.run.create({
                data: { assignmentId: assignment.id, organizationId: harness.organizationId, status: "pending" },
            });
            await harness.db.run.create({
                data: { assignmentId: assignment.id, organizationId: harness.organizationId, status: "pending" },
            });

            const runs = await harness.request().runs.list();
            expect(runs.length).toBeGreaterThanOrEqual(2);
        });

        test("list filters by applicationId", async ({ harness, seedResult: { application, assignment } }) => {
            await harness.db.run.create({
                data: { assignmentId: assignment.id, organizationId: harness.organizationId, status: "pending" },
            });

            const all = await harness.request().runs.list();
            const filtered = await harness.request().runs.list({ applicationId: application.id });
            const otherApp = await harness.request().runs.list({ applicationId: "other-app-id" });

            expect(filtered.length).toBeLessThanOrEqual(all.length);
            expect(filtered.every((r) => r.name === "Login flow test")).toBe(true);
            expect(otherApp).toHaveLength(0);
        });

        test("list returns correct shape", async ({ harness, seedResult: { assignment } }) => {
            const run = await harness.db.run.create({
                data: { assignmentId: assignment.id, organizationId: harness.organizationId, status: "pending" },
            });

            const runs = await harness.request().runs.list();
            const listed = runs.find((r) => r.id === run.id);

            expect(listed).toBeDefined();
            expect(listed?.shortId).toBe(run.id.slice(0, 8));
            expect(listed?.status).toBe("pending");
            expect(listed?.name).toBe("Login flow test");
            expect(listed?.tags).toEqual([]);
            expect(listed?.stepCount).toBe(0);
            expect(listed?.duration).toBeNull();
        });

        test("detail returns run with steps after completion", async ({
            harness,
            seedResult: { assignment, stepOutputList },
        }) => {
            const run = await harness.db.run.create({
                data: { assignmentId: assignment.id, organizationId: harness.organizationId, status: "pending" },
            });
            const runId = run.id;

            // Simulate the run completing with output steps
            await harness.db.stepOutputList.update({
                where: { id: stepOutputList.id },
                data: { runId },
            });
            await harness.db.run.update({
                where: { id: runId },
                data: { status: "success", startedAt: new Date(), completedAt: new Date() },
            });

            const detail = await harness.request().runs.detail({ runId });

            expect(detail).not.toBeNull();
            expect(detail?.id).toBe(runId);
            expect(detail?.shortId).toBe(runId.slice(0, 8));
            expect(detail?.status).toBe("success");
            expect(detail?.name).toBe("Login flow test");
            expect(detail?.steps).toHaveLength(2);
            expect(detail?.steps[0]?.interaction).toBe("navigate");
            expect(detail?.steps[0]?.order).toBe(0);
            expect(detail?.steps[1]?.interaction).toBe("click");
            expect(detail?.steps[1]?.order).toBe(1);
            // The seed snapshot belongs to the main branch, which has no PR.
            expect(detail?.pullRequest).toBeUndefined();
        });

        test("detail exposes the pull request and snapshot when the run's snapshot belongs to a PR", async ({
            harness,
            seedResult: { application, testCase },
        }) => {
            const branch = await harness.db.branch.create({
                data: {
                    name: "feature/login",
                    applicationId: application.id,
                    organizationId: harness.organizationId,
                },
            });
            const snapshot = await harness.db.branchSnapshot.create({
                data: { branchId: branch.id, source: "GITHUB_PUSH", headSha: "abcdef1234567" },
            });
            await harness.db.featureBranchInfo.create({
                data: { branchId: branch.id, applicationId: application.id, prNumber: 42 },
            });
            const assignment = await harness.db.testCaseAssignment.create({
                data: { testCaseId: testCase.id, snapshotId: snapshot.id },
            });
            const run = await harness.db.run.create({
                data: { assignmentId: assignment.id, organizationId: harness.organizationId, status: "success" },
            });

            const detail = await harness.request().runs.detail({ runId: run.id });

            expect(detail?.pullRequest).toEqual({
                number: 42,
                snapshotId: snapshot.id,
                snapshotSha: "abcdef1234567",
            });
        });

        test("detail returns null for non-existent run", async ({ harness }) => {
            const detail = await harness.request().runs.detail({ runId: "non-existent-id" });
            expect(detail).toBeNull();
        });

        test("detail returns null for run belonging to another organization", async ({
            harness,
            seedResult: { assignment },
        }) => {
            const run = await harness.db.run.create({
                data: { assignmentId: assignment.id, organizationId: harness.organizationId, status: "pending" },
            });

            const otherOrg = await harness.db.organization.create({
                data: { name: "Other Org", slug: `other-org-${crypto.randomUUID()}` },
            });
            const otherSession = await harness.db.session.create({
                data: {
                    token: `other-session-${crypto.randomUUID()}`,
                    expiresAt: new Date(Date.now() + 86400000),
                    userId: harness.userId,
                    activeOrganizationId: otherOrg.id,
                },
            });

            const detail = await harness.request(otherSession).runs.detail({ runId: run.id });
            expect(detail).toBeNull();
        });
    },
});
