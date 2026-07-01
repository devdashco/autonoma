import { describe, expect, it } from "vitest";
import type { BranchEdit, MainSuiteEntry } from "../../src/merge/merge-inputs";
import { buildMergePrompt } from "../../src/merge/prompt";

const MAIN_SUITE: MainSuiteEntry[] = [{ slug: "login-flow", name: "Login", flow: "Auth", description: "signs in" }];

describe("buildMergePrompt", () => {
    it("renders a modification as a 3-way view (base, proposed, main now)", () => {
        const edit: BranchEdit = {
            kind: "modification",
            ref: "checkout-flow",
            name: "Checkout",
            flow: "Commerce",
            description: "buys an item",
            proposedPlan: "PROPOSED-PLAN-TEXT",
            basePlan: "BASE-PLAN-TEXT",
            mainCurrentPlan: "MAIN-NOW-PLAN-TEXT",
        };
        const prompt = buildMergePrompt([edit], MAIN_SUITE);

        expect(prompt).toContain("ref: checkout-flow");
        expect(prompt).toContain("BASE-PLAN-TEXT");
        expect(prompt).toContain("PROPOSED-PLAN-TEXT");
        expect(prompt).toContain("MAIN-NOW-PLAN-TEXT");
        // Main's catalog line is present for coverage detection.
        expect(prompt).toContain("login-flow");
    });

    it("marks a modification whose test was deleted on main", () => {
        const edit: BranchEdit = {
            kind: "modification",
            ref: "gone",
            name: "Gone",
            flow: "Commerce",
            description: "d",
            proposedPlan: "p",
            basePlan: "b",
        };
        const prompt = buildMergePrompt([edit], MAIN_SUITE);
        expect(prompt).toContain("no longer exists on main");
    });

    it("renders a new test with just its proposed plan", () => {
        const edit: BranchEdit = {
            kind: "new_test",
            ref: "coupon",
            name: "Coupon",
            flow: "Investigation",
            description: "d",
            proposedPlan: "NEW-PLAN-TEXT",
        };
        const prompt = buildMergePrompt([edit], MAIN_SUITE);
        expect(prompt).toContain("new_test");
        expect(prompt).toContain("NEW-PLAN-TEXT");
    });
});
