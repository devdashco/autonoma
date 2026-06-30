import { describe, expect, test } from "vitest";
import type { AuditedModel } from "../../src/agents/04-recipe-builder/entity-order";
import { buildSingleEntityRecipe } from "../../src/agents/04-recipe-builder/recipe";
import type { EntityProgress } from "../../src/agents/04-recipe-builder/state";

function model(name: string, createdBy: string[] = []): AuditedModel {
    return {
        name,
        independently_created: true,
        created_by: createdBy.map((owner) => ({ owner })),
    };
}

function progress(entityName: string, recipeData?: Record<string, unknown>[]): EntityProgress {
    return { entityName, status: "recipe-accepted", recipeData, errorLog: [] };
}

describe("buildSingleEntityRecipe", () => {
    test("includes a parent referenced via _ref even when the audit's created_by omits it", () => {
        // The reported bug: Profile _refs user_1, but the audit never recorded User
        // as a parent of Profile. The User records must still be in the payload.
        const models = [model("User"), model("Profile" /* no created_by */)];
        const entityOrder = ["User", "Profile"];
        const entities: Record<string, EntityProgress> = {
            User: progress("User", [{ _alias: "user_1", email: "a@b.com" }]),
            Profile: progress("Profile", [{ _alias: "prof_1", userId: { _ref: "user_1" } }]),
        };

        const recipe = buildSingleEntityRecipe("Profile", models, entityOrder, entities);

        expect(Object.keys(recipe)).toEqual(["User", "Profile"]); // parent first
        expect(recipe.User).toHaveLength(1);
        expect(recipe.Profile).toHaveLength(1);
    });

    test("emits dependencies before dependents (topological order)", () => {
        // LineItem -> Order -> Customer, all via _ref only (no created_by).
        const models = [model("Customer"), model("Order"), model("LineItem")];
        const entityOrder = ["Customer", "Order", "LineItem"];
        const entities: Record<string, EntityProgress> = {
            Customer: progress("Customer", [{ _alias: "cust_1" }]),
            Order: progress("Order", [{ _alias: "order_1", customer: { _ref: "cust_1" } }]),
            LineItem: progress("LineItem", [{ _alias: "li_1", order: { _ref: "order_1" } }]),
        };

        const recipe = buildSingleEntityRecipe("LineItem", models, entityOrder, entities);

        expect(Object.keys(recipe)).toEqual(["Customer", "Order", "LineItem"]);
    });

    test("still includes audit-declared created_by parents even when unreferenced", () => {
        const models = [model("Org"), model("Project", ["Org"])];
        const entityOrder = ["Org", "Project"];
        const entities: Record<string, EntityProgress> = {
            Org: progress("Org", [{ _alias: "org_1" }]),
            // Project doesn't _ref org_1, but the audit says Org owns it.
            Project: progress("Project", [{ _alias: "proj_1", name: "x" }]),
        };

        const recipe = buildSingleEntityRecipe("Project", models, entityOrder, entities);

        expect(Object.keys(recipe)).toEqual(["Org", "Project"]);
    });

    test("collects refs nested inside arrays and objects", () => {
        const models = [model("Tag"), model("Post")];
        const entityOrder = ["Tag", "Post"];
        const entities: Record<string, EntityProgress> = {
            Tag: progress("Tag", [{ _alias: "tag_1" }, { _alias: "tag_2" }]),
            Post: progress("Post", [{ _alias: "post_1", tags: [{ _ref: "tag_1" }, { _ref: "tag_2" }] }]),
        };

        const recipe = buildSingleEntityRecipe("Post", models, entityOrder, entities);

        expect(Object.keys(recipe)).toEqual(["Tag", "Post"]);
    });

    test("ignores a _ref to an unknown alias without crashing (typo/hallucination)", () => {
        const models = [model("Profile")];
        const entityOrder = ["Profile"];
        const entities: Record<string, EntityProgress> = {
            Profile: progress("Profile", [{ _alias: "prof_1", userId: { _ref: "user_404" } }]),
        };

        const recipe = buildSingleEntityRecipe("Profile", models, entityOrder, entities);

        expect(Object.keys(recipe)).toEqual(["Profile"]);
    });

    test("omits entities with no accepted recipe data", () => {
        const models = [model("User"), model("Profile")];
        const entityOrder = ["User", "Profile"];
        const entities: Record<string, EntityProgress> = {
            User: progress("User", undefined), // not yet generated
            Profile: progress("Profile", [{ _alias: "prof_1", userId: { _ref: "user_1" } }]),
        };

        const recipe = buildSingleEntityRecipe("Profile", models, entityOrder, entities);

        // user_1 is undeclared, so User can't be included - only Profile ships.
        expect(Object.keys(recipe)).toEqual(["Profile"]);
    });

    test("does not infinite-loop on a reference cycle", () => {
        const models = [model("A"), model("B")];
        const entityOrder = ["A", "B"];
        const entities: Record<string, EntityProgress> = {
            A: progress("A", [{ _alias: "a_1", b: { _ref: "b_1" } }]),
            B: progress("B", [{ _alias: "b_1", a: { _ref: "a_1" } }]),
        };

        const recipe = buildSingleEntityRecipe("A", models, entityOrder, entities);

        expect(new Set(Object.keys(recipe))).toEqual(new Set(["A", "B"]));
    });
});
