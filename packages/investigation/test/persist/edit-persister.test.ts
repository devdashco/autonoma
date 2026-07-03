import { createDetachedSnapshot } from "@autonoma/test-updates";
import { expect } from "vitest";
import { EditPersister } from "../../src";
import { investigationDbSuite } from "../harness";

investigationDbSuite({
    name: "EditPersister",
    cases: (test) => {
        test("persists a modification and a new test onto the twin, leaving the active suite untouched", async ({
            harness,
            seedResult: { organizationId, application },
        }) => {
            // The branch's real (diffs) suite: one active snapshot with one test.
            const { snapshotId: activeSnapshotId, testCaseId } = await harness.setupTestCase(
                organizationId,
                application.id,
                "checkout-flow",
            );
            const activeBefore = await harness.db.testCaseAssignment.findFirstOrThrow({
                where: { snapshotId: activeSnapshotId, testCaseId },
                select: { planId: true },
            });

            // The detached investigation twin, forked from the branch's active suite.
            const branch = await harness.db.branch.findFirstOrThrow({
                where: { applicationId: application.id },
                select: { id: true },
            });
            const twin = await createDetachedSnapshot({ db: harness.db, branchId: branch.id, organizationId });
            if (twin == null) throw new Error("expected a detached twin to be created");

            const result = await new EditPersister(harness.db).persist(
                twin.snapshotId,
                organizationId,
                [{ slug: "checkout-flow", plan: "modified checkout plan" }],
                [{ name: "New coupon test", description: "coupon applies a discount", plan: "new coupon plan" }],
                [],
            );

            expect(result.skipped).toEqual([]);
            expect(result.persisted).toHaveLength(2);

            // The twin's existing test now points at a fresh plan carrying the revised prompt.
            const twinAssignment = await harness.db.testCaseAssignment.findFirstOrThrow({
                where: { snapshotId: twin.snapshotId, testCaseId },
                select: { plan: { select: { id: true, prompt: true } } },
            });
            expect(twinAssignment.plan?.prompt).toBe("modified checkout plan");
            expect(twinAssignment.plan?.id).not.toBe(activeBefore.planId);

            // The active (diffs) suite is untouched.
            const activeAfter = await harness.db.testCaseAssignment.findFirstOrThrow({
                where: { snapshotId: activeSnapshotId, testCaseId },
                select: { planId: true, plan: { select: { prompt: true } } },
            });
            expect(activeAfter.planId).toBe(activeBefore.planId);
            expect(activeAfter.plan?.prompt).toBe("initial plan");

            // The new test exists on the twin only, in the Investigation folder.
            const newOnTwin = await harness.db.testCaseAssignment.findFirst({
                where: { snapshotId: twin.snapshotId, testCase: { name: "New coupon test" } },
                select: { testCase: { select: { description: true, folder: { select: { name: true } } } } },
            });
            expect(newOnTwin?.testCase.description).toBe("coupon applies a discount");
            expect(newOnTwin?.testCase.folder.name).toBe("Investigation");

            const newOnActive = await harness.db.testCaseAssignment.findFirst({
                where: { snapshotId: activeSnapshotId, testCase: { name: "New coupon test" } },
            });
            expect(newOnActive).toBeNull();
        });

        test("records a modification for a test not on the snapshot as skipped, not thrown", async ({
            harness,
            seedResult: { organizationId, application },
        }) => {
            await harness.setupTestCase(organizationId, application.id, "present-test");
            const branch = await harness.db.branch.findFirstOrThrow({
                where: { applicationId: application.id },
                select: { id: true },
            });
            const twin = await createDetachedSnapshot({ db: harness.db, branchId: branch.id, organizationId });
            if (twin == null) throw new Error("expected a detached twin to be created");

            const result = await new EditPersister(harness.db).persist(
                twin.snapshotId,
                organizationId,
                [{ slug: "does-not-exist", plan: "irrelevant" }],
                [],
                [],
            );

            expect(result.persisted).toEqual([]);
            expect(result.skipped).toEqual([
                { kind: "modification", ref: "does-not-exist", reason: "test not assigned to snapshot" },
            ]);
        });

        test("removes a test from the twin by deleting its assignment, leaving the active suite untouched", async ({
            harness,
            seedResult: { organizationId, application },
        }) => {
            const {
                branchId,
                snapshotId: activeSnapshotId,
                testCaseId,
            } = await harness.setupTestCase(organizationId, application.id, "deprecated-flow");
            const twin = await createDetachedSnapshot({ db: harness.db, branchId, organizationId });
            if (twin == null) throw new Error("expected a detached twin to be created");

            // Forked from active, the test starts assigned to the twin.
            const before = await harness.db.testCaseAssignment.findFirst({
                where: { snapshotId: twin.snapshotId, testCaseId },
            });
            expect(before).not.toBeNull();

            const result = await new EditPersister(harness.db).persist(
                twin.snapshotId,
                organizationId,
                [],
                [],
                ["deprecated-flow"],
            );

            expect(result.skipped).toEqual([]);
            expect(result.persisted).toEqual([{ kind: "removed", ref: "deprecated-flow", testCaseId }]);

            // Gone from the twin...
            const afterTwin = await harness.db.testCaseAssignment.findFirst({
                where: { snapshotId: twin.snapshotId, testCaseId },
            });
            expect(afterTwin).toBeNull();

            // ...but the active (diffs) suite still has it, and the global TestCase is never deleted.
            const afterActive = await harness.db.testCaseAssignment.findFirst({
                where: { snapshotId: activeSnapshotId, testCaseId },
            });
            expect(afterActive).not.toBeNull();
            const stillExists = await harness.db.testCase.findUnique({ where: { id: testCaseId } });
            expect(stillExists).not.toBeNull();
        });

        test("records a removal for a test not on the snapshot as skipped, not thrown", async ({
            harness,
            seedResult: { organizationId, application },
        }) => {
            const { branchId } = await harness.setupTestCase(organizationId, application.id, "removal-present-test");
            const twin = await createDetachedSnapshot({ db: harness.db, branchId, organizationId });
            if (twin == null) throw new Error("expected a detached twin to be created");

            const result = await new EditPersister(harness.db).persist(
                twin.snapshotId,
                organizationId,
                [],
                [],
                ["does-not-exist"],
            );

            expect(result.persisted).toEqual([]);
            expect(result.skipped).toEqual([
                { kind: "removal", ref: "does-not-exist", reason: "test not assigned to snapshot" },
            ]);
        });
    },
});
