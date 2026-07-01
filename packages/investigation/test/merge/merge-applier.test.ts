import { expect } from "vitest";
import { MergeApplier } from "../../src/merge/merge-applier";
import type { BranchEdit } from "../../src/merge/merge-inputs";
import type { MergePlan } from "../../src/merge/schema";
import { investigationDbSuite } from "../harness";

investigationDbSuite({
    name: "MergeApplier",
    cases: (test) => {
        test("applies accepted edits onto a detached main proposal, leaving main's active suite untouched", async ({
            harness,
            seedResult: { organizationId, application },
        }) => {
            const { branchId: mainBranchId, snapshotId: mainSnapshotId } = await harness.setupTestCase(
                organizationId,
                application.id,
                "checkout-flow",
            );
            const mainActiveBefore = await harness.db.testCaseAssignment.findFirstOrThrow({
                where: { snapshotId: mainSnapshotId },
                select: { planId: true, plan: { select: { prompt: true } } },
            });

            const edits: BranchEdit[] = [
                {
                    kind: "modification",
                    ref: "checkout-flow",
                    name: "checkout-flow",
                    flow: "default",
                    description: "d",
                    proposedPlan: "reconciled checkout plan",
                    basePlan: "initial plan",
                    mainCurrentPlan: "initial plan",
                },
                {
                    kind: "new_test",
                    ref: "coupon",
                    name: "Coupon test",
                    flow: "Investigation",
                    description: "coupon applies a discount",
                    proposedPlan: "coupon plan",
                },
            ];
            const plan: MergePlan = {
                decisions: [
                    { kind: "modification", ref: "checkout-flow", action: "apply", reason: "clean apply" },
                    { kind: "new_test", ref: "coupon", action: "skip", reason: "already covered" },
                ],
            };

            const result = await new MergeApplier(harness.db).apply(edits, plan, mainBranchId, organizationId);

            // One accepted (the modification), one skipped (the new test).
            expect(result.appliedCount).toBe(1);
            expect(result.skippedCount).toBe(1);
            expect(result.mainProposalSnapshotId).toBeDefined();

            // The proposal snapshot carries the reconciled plan; it is NOT the main active snapshot.
            expect(result.mainProposalSnapshotId).not.toBe(mainSnapshotId);
            const proposalAssignment = await harness.db.testCaseAssignment.findFirstOrThrow({
                where: { snapshotId: result.mainProposalSnapshotId, testCase: { slug: "checkout-flow" } },
                select: { plan: { select: { prompt: true } } },
            });
            expect(proposalAssignment.plan?.prompt).toBe("reconciled checkout plan");

            // The skipped new test was NOT added anywhere.
            const couponAnywhere = await harness.db.testCase.findFirst({ where: { name: "Coupon test" } });
            expect(couponAnywhere).toBeNull();

            // Main's active suite is untouched - shadow guarantee.
            const mainActiveAfter = await harness.db.testCaseAssignment.findFirstOrThrow({
                where: { snapshotId: mainSnapshotId },
                select: { planId: true, plan: { select: { prompt: true } } },
            });
            expect(mainActiveAfter.planId).toBe(mainActiveBefore.planId);
            expect(mainActiveAfter.plan?.prompt).toBe("initial plan");
        });

        test("creates no proposal snapshot when every decision is skipped", async ({
            harness,
            seedResult: { organizationId, application },
        }) => {
            const { branchId: mainBranchId } = await harness.setupTestCase(organizationId, application.id, "some-flow");
            const edits: BranchEdit[] = [
                { kind: "new_test", ref: "x", name: "X", flow: "Investigation", description: "d", proposedPlan: "p" },
            ];
            const plan: MergePlan = {
                decisions: [{ kind: "new_test", ref: "x", action: "skip", reason: "redundant" }],
            };

            const result = await new MergeApplier(harness.db).apply(edits, plan, mainBranchId, organizationId);

            expect(result.appliedCount).toBe(0);
            expect(result.skippedCount).toBe(1);
            expect(result.mainProposalSnapshotId).toBeUndefined();
        });
    },
});
