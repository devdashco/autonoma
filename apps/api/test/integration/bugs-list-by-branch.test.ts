import { ApplicationArchitecture } from "@autonoma/db";
import { expect } from "vitest";
import { apiTestSuite } from "../api-test";
import type { APITestHarness } from "../harness";

async function seedFixture(harness: APITestHarness) {
    const application = await harness.services.applications.createApplication({
        name: "Bug Branch App",
        organizationId: harness.organizationId,
        architecture: ApplicationArchitecture.WEB,
        url: "https://example.com",
        file: "s3://bucket/default-file.png",
    });

    const folder = await harness.db.folder.create({
        data: {
            name: "Checkout",
            applicationId: application.id,
            organizationId: harness.organizationId,
        },
    });

    const testCase = await harness.db.testCase.create({
        data: {
            name: "Checkout succeeds",
            slug: "checkout-succeeds",
            applicationId: application.id,
            folderId: folder.id,
            organizationId: harness.organizationId,
        },
    });

    const testPlan = await harness.db.testPlan.create({
        data: {
            testCaseId: testCase.id,
            prompt: "Verify checkout succeeds.",
            organizationId: harness.organizationId,
        },
    });

    const runTestCase = await harness.db.testCase.create({
        data: {
            name: "Checkout run catches regression",
            slug: "checkout-run-catches-regression",
            applicationId: application.id,
            folderId: folder.id,
            organizationId: harness.organizationId,
        },
    });

    const runTestPlan = await harness.db.testPlan.create({
        data: {
            testCaseId: runTestCase.id,
            prompt: "Verify checkout run catches regression.",
            organizationId: harness.organizationId,
        },
    });

    const branch = await harness.db.branch.create({
        data: {
            name: "feature/pr-bugs",
            applicationId: application.id,
            organizationId: harness.organizationId,
            prInfo: { create: { applicationId: application.id, prNumber: 123 } },
        },
    });

    const otherBranch = await harness.db.branch.create({
        data: {
            name: "feature/other",
            applicationId: application.id,
            organizationId: harness.organizationId,
            prInfo: { create: { applicationId: application.id, prNumber: 124 } },
        },
    });

    const [firstSnapshot, secondSnapshot, otherSnapshot] = await Promise.all([
        harness.db.branchSnapshot.create({
            data: { branchId: branch.id, source: "GITHUB_PUSH", status: "active" },
        }),
        harness.db.branchSnapshot.create({
            data: { branchId: branch.id, source: "GITHUB_PUSH", status: "active" },
        }),
        harness.db.branchSnapshot.create({
            data: { branchId: otherBranch.id, source: "GITHUB_PUSH", status: "active" },
        }),
    ]);

    // Open bug on the target branch, re-detected across two commits -> two occurrences.
    const branchBug = await harness.db.bug.create({
        data: {
            title: "Checkout button crashes",
            description: "The checkout button throws during payment.",
            severity: "critical",
            branchId: branch.id,
            applicationId: application.id,
            organizationId: harness.organizationId,
            evidence: { create: { testCaseId: testCase.id } },
        },
    });

    // A second open bug on the same branch, without evidence screenshots.
    const secondBranchBug = await harness.db.bug.create({
        data: {
            title: "Totals miscalculated",
            description: "Line item totals are off by a cent.",
            severity: "high",
            branchId: branch.id,
            applicationId: application.id,
            organizationId: harness.organizationId,
            evidence: { create: { testCaseId: testCase.id } },
        },
    });

    // A bug detected via a replay run review, on the same branch.
    const runReviewBug = await harness.db.bug.create({
        data: {
            title: "Run review bug",
            description: "A bug reported from replay review.",
            severity: "medium",
            branchId: branch.id,
            applicationId: application.id,
            organizationId: harness.organizationId,
            evidence: { create: { testCaseId: runTestCase.id } },
        },
    });

    // A resolved bug on the target branch - excluded from the default open query.
    const resolvedBug = await harness.db.bug.create({
        data: {
            title: "Resolved branch bug",
            description: "A resolved bug on this branch.",
            severity: "medium",
            status: "resolved",
            resolvedAt: new Date(),
            branchId: branch.id,
            applicationId: application.id,
            organizationId: harness.organizationId,
        },
    });

    // A bug on a different branch - must never leak into the target branch view.
    const otherBranchBug = await harness.db.bug.create({
        data: {
            title: "Other branch bug",
            description: "A bug on a different branch.",
            severity: "high",
            branchId: otherBranch.id,
            applicationId: application.id,
            organizationId: harness.organizationId,
        },
    });

    // A bug abandoned by the branch-scoping migration (branchId = null). It stays in the
    // table but must fall out of every branch-scoped view.
    const abandonedBug = await harness.db.bug.create({
        data: {
            title: "Abandoned pre-migration bug",
            description: "Left with a null branch by the additive migration.",
            severity: "critical",
            applicationId: application.id,
            organizationId: harness.organizationId,
        },
    });

    await createIssueForBug(harness, {
        bugId: branchBug.id,
        snapshotId: firstSnapshot.id,
        testPlanId: testPlan.id,
        title: "Checkout fails on first snapshot",
        screenshotKey: "evidence/first-snapshot.jpeg",
    });
    await createIssueForBug(harness, {
        bugId: branchBug.id,
        snapshotId: secondSnapshot.id,
        testPlanId: testPlan.id,
        title: "Checkout fails on second snapshot",
        screenshotKey: "evidence/second-snapshot.jpeg",
    });
    await createIssueForBug(harness, {
        bugId: secondBranchBug.id,
        snapshotId: secondSnapshot.id,
        testPlanId: testPlan.id,
        title: "Totals bug without thumbnail",
    });
    await createRunIssueForBug(harness, {
        bugId: runReviewBug.id,
        snapshotId: secondSnapshot.id,
        testCaseId: runTestCase.id,
        testPlanId: runTestPlan.id,
        title: "Run review issue with thumbnail",
        screenshotKey: "evidence/run-review.jpeg",
    });
    await createIssueForBug(harness, {
        bugId: otherBranchBug.id,
        snapshotId: otherSnapshot.id,
        testPlanId: testPlan.id,
        title: "Other branch issue",
    });

    return {
        application,
        branch,
        otherBranch,
        branchBug,
        secondBranchBug,
        runReviewBug,
        resolvedBug,
        otherBranchBug,
        abandonedBug,
    };
}

async function createIssueForBug(
    harness: APITestHarness,
    input: {
        bugId: string;
        snapshotId: string;
        testPlanId: string;
        title: string;
        screenshotKey?: string;
    },
) {
    const generation = await harness.db.testGeneration.create({
        data: {
            testPlanId: input.testPlanId,
            snapshotId: input.snapshotId,
            organizationId: harness.organizationId,
        },
    });

    const review = await harness.db.generationReview.create({
        data: {
            generationId: generation.id,
            status: "completed",
            verdict: "application_bug",
            analysis: buildAnalysis(input.screenshotKey),
            organizationId: harness.organizationId,
        },
    });

    await harness.db.issue.create({
        data: {
            generationReviewId: review.id,
            bugId: input.bugId,
            title: input.title,
            description: input.title,
            severity: "critical",
            organizationId: harness.organizationId,
        },
    });
}

async function createRunIssueForBug(
    harness: APITestHarness,
    input: {
        bugId: string;
        snapshotId: string;
        testCaseId: string;
        testPlanId: string;
        title: string;
        screenshotKey?: string;
    },
) {
    const assignment = await harness.db.testCaseAssignment.create({
        data: {
            snapshotId: input.snapshotId,
            testCaseId: input.testCaseId,
            planId: input.testPlanId,
        },
    });

    const run = await harness.db.run.create({
        data: {
            assignmentId: assignment.id,
            status: "failed",
            organizationId: harness.organizationId,
        },
    });

    const review = await harness.db.runReview.create({
        data: {
            runId: run.id,
            status: "completed",
            verdict: "application_bug",
            analysis: buildAnalysis(input.screenshotKey),
            organizationId: harness.organizationId,
        },
    });

    await harness.db.issue.create({
        data: {
            runReviewId: review.id,
            bugId: input.bugId,
            title: input.title,
            description: input.title,
            severity: "critical",
            organizationId: harness.organizationId,
        },
    });
}

function buildAnalysis(screenshotKey: string | undefined) {
    if (screenshotKey == null) return {};
    return {
        evidence: [
            {
                type: "screenshot",
                description: "Failure screenshot",
                s3Key: screenshotKey,
            },
        ],
    };
}

apiTestSuite({
    name: "bugs.listByBranch",
    seed: async ({ harness }) => seedFixture(harness),
    cases: (test) => {
        test("returns open bugs scoped to a single branch", async ({ harness, seedResult }) => {
            const bugs = await harness.request().bugs.listByBranch({ branchId: seedResult.branch.id });

            expect(bugs.map((bug) => bug.id)).toEqual(
                expect.arrayContaining([
                    seedResult.branchBug.id,
                    seedResult.secondBranchBug.id,
                    seedResult.runReviewBug.id,
                ]),
            );
            expect(bugs.map((bug) => bug.id)).not.toContain(seedResult.otherBranchBug.id);
            expect(bugs.map((bug) => bug.id)).not.toContain(seedResult.resolvedBug.id);
            expect(bugs.map((bug) => bug.id)).not.toContain(seedResult.abandonedBug.id);
        });

        test("collapses a branch's commits into occurrences and surfaces the latest thumbnail", async ({
            harness,
            seedResult,
        }) => {
            const bugs = await harness.request().bugs.listByBranch({ branchId: seedResult.branch.id });

            const branchBug = bugs.find((bug) => bug.id === seedResult.branchBug.id);
            expect(branchBug?.occurrences).toBe(2);
            expect(branchBug?.thumbnail?.url).toContain("evidence/second-snapshot.jpeg");

            const runReviewBug = bugs.find((bug) => bug.id === seedResult.runReviewBug.id);
            expect(runReviewBug?.occurrences).toBe(1);
            expect(runReviewBug?.thumbnail?.url).toContain("evidence/run-review.jpeg");

            const secondBranchBug = bugs.find((bug) => bug.id === seedResult.secondBranchBug.id);
            expect(secondBranchBug?.thumbnail).toBeUndefined();
        });

        test("returns the other branch's own bug when pointed at it", async ({ harness, seedResult }) => {
            const bugs = await harness.request().bugs.listByBranch({ branchId: seedResult.otherBranch.id });

            expect(bugs.map((bug) => bug.id)).toEqual([seedResult.otherBranchBug.id]);
        });

        test("returns resolved bugs when the status filter asks for them", async ({ harness, seedResult }) => {
            const bugs = await harness.request().bugs.listByBranch({
                branchId: seedResult.branch.id,
                status: "resolved",
            });

            expect(bugs.map((bug) => bug.id)).toEqual([seedResult.resolvedBug.id]);
        });
    },
});
