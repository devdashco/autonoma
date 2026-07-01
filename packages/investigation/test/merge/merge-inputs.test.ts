import { createDetachedSnapshot } from "@autonoma/test-updates";
import { expect } from "vitest";
import { MergeInputsReader } from "../../src/merge/merge-inputs";
import { EditPersister } from "../../src/persist/edit-persister";
import { investigationDbSuite } from "../harness";

investigationDbSuite({
    name: "MergeInputsReader",
    cases: (test) => {
        test("derives the branch's new test and modification from the twin, enriched with main's suite", async ({
            harness,
            seedResult: { organizationId, application },
        }) => {
            // Main's suite: the branch's active (main-representing) snapshot with one test.
            const { branchId, snapshotId: mainSnapshotId } = await harness.setupTestCase(
                organizationId,
                application.id,
                "checkout-flow",
            );

            // The investigation twin, forked from that suite, with one modification + one added test persisted.
            const twin = await createDetachedSnapshot({ db: harness.db, branchId, organizationId });
            if (twin == null) throw new Error("expected a detached twin");
            await new EditPersister(harness.db).persist(
                twin.snapshotId,
                organizationId,
                [{ slug: "checkout-flow", plan: "revised checkout plan" }],
                [{ name: "Coupon test", description: "coupon applies a discount", plan: "new coupon plan" }],
            );

            const inputs = await new MergeInputsReader(harness.db).read(
                twin.snapshotId,
                mainSnapshotId,
                organizationId,
            );

            // Exactly the two edits, nothing for the untouched login-flow.
            const modification = inputs.edits.find((edit) => edit.kind === "modification");
            const newTest = inputs.edits.find((edit) => edit.kind === "new_test");
            expect(inputs.edits).toHaveLength(2);

            expect(modification).toMatchObject({ ref: "checkout-flow", proposedPlan: "revised checkout plan" });
            // basePlan is the fork-point plan; mainCurrentPlan is main's plan for the same slug (here unchanged).
            expect(modification?.basePlan).toBe("initial plan");
            expect(modification?.mainCurrentPlan).toBe("initial plan");

            expect(newTest).toMatchObject({ name: "Coupon test", proposedPlan: "new coupon plan" });
            expect(newTest?.ref).toContain("coupon");
            // The real persisted test-case description is carried through (not a plan-frontmatter summary).
            expect(newTest?.description).toBe("coupon applies a discount");
            // A brand-new test has no baseline on main.
            expect(newTest?.basePlan).toBeUndefined();

            // Main's suite carries its current tests (the new coupon test lives on the twin, not main).
            expect(inputs.mainSuite.map((entry) => entry.slug)).toEqual(["checkout-flow"]);
        });

        test("returns no edits when the twin has no diff from its baseline", async ({
            harness,
            seedResult: { organizationId, application },
        }) => {
            const { branchId, snapshotId: mainSnapshotId } = await harness.setupTestCase(
                organizationId,
                application.id,
                "unchanged-flow",
            );
            const twin = await createDetachedSnapshot({ db: harness.db, branchId, organizationId });
            if (twin == null) throw new Error("expected a detached twin");

            const inputs = await new MergeInputsReader(harness.db).read(
                twin.snapshotId,
                mainSnapshotId,
                organizationId,
            );

            expect(inputs.edits).toEqual([]);
            expect(inputs.mainSuite).toHaveLength(1);
        });
    },
});
