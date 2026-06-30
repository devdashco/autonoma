import { describe, expect, test } from "vitest";
import type { AuditedModel } from "../../src/agents/04-recipe-builder/entity-order";
import { resolveEntityOrder } from "../../src/agents/04-recipe-builder/entity-order";
import { reconcileRanking } from "../../src/agents/04-recipe-builder/entity-relevance";

function root(name: string): AuditedModel {
    return { name, independently_created: true, created_by: [] };
}

function dependent(name: string, owner: string): AuditedModel {
    return { name, independently_created: true, created_by: [{ owner }] };
}

describe("reconcileRanking", () => {
    test("passes through a correct, complete ranking unchanged", () => {
        const canonical = ["A", "B", "C"];
        const res = reconcileRanking(canonical, ["B", "A", "C"]);
        expect(res.order).toEqual(["B", "A", "C"]);
        expect(res.missing).toEqual([]);
        expect(res.invented).toEqual([]);
        expect(res.duplicates).toEqual([]);
    });

    test("appends missing canonical names in original order", () => {
        const canonical = ["A", "B", "C", "D"];
        const res = reconcileRanking(canonical, ["C", "A"]);
        expect(res.order).toEqual(["C", "A", "B", "D"]);
        expect(res.missing).toEqual(["B", "D"]);
    });

    test("drops invented names not in the canonical set", () => {
        const canonical = ["A", "B"];
        const res = reconcileRanking(canonical, ["B", "ZZZ", "A"]);
        expect(res.order).toEqual(["B", "A"]);
        expect(res.invented).toEqual(["ZZZ"]);
    });

    test("keeps first occurrence and records duplicates", () => {
        const canonical = ["A", "B", "C"];
        const res = reconcileRanking(canonical, ["A", "B", "A", "C", "B"]);
        expect(res.order).toEqual(["A", "B", "C"]);
        expect(res.duplicates).toEqual(["A", "B"]);
    });
});

describe("resolveEntityOrder", () => {
    test("falls back to alphabetical tie-break when no rank is given", () => {
        const models = [root("Charlie"), root("Alpha"), root("Bravo")];
        expect(resolveEntityOrder(models)).toEqual(["Alpha", "Bravo", "Charlie"]);
    });

    test("orders important roots first when a rank is supplied", () => {
        const models = [root("AccessibilityReport"), root("Organization"), root("User")];
        const rank = new Map([
            ["Organization", 0],
            ["User", 1],
            ["AccessibilityReport", 2],
        ]);
        expect(resolveEntityOrder(models, rank)).toEqual(["Organization", "User", "AccessibilityReport"]);
    });

    test("preserves the topological invariant: an owner precedes its dependent", () => {
        // Child is more "important" than its owner, but must still come after it.
        const models = [dependent("Child", "Owner"), root("Owner")];
        const rank = new Map([
            ["Child", 0],
            ["Owner", 1],
        ]);
        const order = resolveEntityOrder(models, rank);
        expect(order.indexOf("Owner")).toBeLessThan(order.indexOf("Child"));
    });

    test("ranks among simultaneously-available entities, not globally", () => {
        // Two roots + one dependent of the lower-ranked root. The high-rank root
        // surfaces first; the dependent only becomes available after its owner.
        const models = [root("Org"), root("Niche"), dependent("OrgChild", "Org")];
        const rank = new Map([
            ["Org", 0],
            ["OrgChild", 1],
            ["Niche", 2],
        ]);
        expect(resolveEntityOrder(models, rank)).toEqual(["Org", "OrgChild", "Niche"]);
    });
});
