import { describe, expect, test } from "vitest";
import {
    emptyEntityCoverage,
    recordEntityTest,
    recordVariation,
    setPossibleValues,
    buildCoverageReport,
    formatCoverageReport,
} from "../../src/agents/05-test-generator/coverage";

describe("entity coverage", () => {
    test("emptyEntityCoverage returns empty object", () => {
        expect(emptyEntityCoverage()).toEqual({});
    });

    test("recordEntityTest creates entity and adds test path", () => {
        const map = emptyEntityCoverage();
        recordEntityTest(map, "User", "tests/user-login.md");
        expect(map.User!.testedInTests).toEqual(["tests/user-login.md"]);
    });

    test("recordEntityTest deduplicates test paths", () => {
        const map = emptyEntityCoverage();
        recordEntityTest(map, "User", "tests/user-login.md");
        recordEntityTest(map, "User", "tests/user-login.md");
        expect(map.User!.testedInTests).toHaveLength(1);
    });

    test("recordEntityTest adds to existing entity", () => {
        const map = emptyEntityCoverage();
        recordEntityTest(map, "User", "t1.md");
        recordEntityTest(map, "User", "t2.md");
        expect(map.User!.testedInTests).toEqual(["t1.md", "t2.md"]);
    });

    test("recordVariation creates entity and field", () => {
        const map = emptyEntityCoverage();
        recordVariation(map, "Payment", "status", "completed");
        expect(map.Payment!.variations.status!.testedValues).toEqual(["completed"]);
    });

    test("recordVariation deduplicates values", () => {
        const map = emptyEntityCoverage();
        recordVariation(map, "Payment", "status", "completed");
        recordVariation(map, "Payment", "status", "completed");
        expect(map.Payment!.variations.status!.testedValues).toHaveLength(1);
    });

    test("setPossibleValues creates entity and sets values", () => {
        const map = emptyEntityCoverage();
        setPossibleValues(map, "Order", "status", ["pending", "shipped", "delivered"]);
        expect(map.Order!.variations.status!.possibleValues).toEqual(["pending", "shipped", "delivered"]);
    });

    test("setPossibleValues updates existing field", () => {
        const map = emptyEntityCoverage();
        setPossibleValues(map, "Order", "status", ["pending"]);
        setPossibleValues(map, "Order", "status", ["pending", "shipped"]);
        expect(map.Order!.variations.status!.possibleValues).toEqual(["pending", "shipped"]);
    });
});

describe("buildCoverageReport", () => {
    test("builds report with zero totals", () => {
        const report = buildCoverageReport(emptyEntityCoverage(), { explored: 0, total: 0 }, { visited: 0, total: 0 });
        expect(report.routes.percentage).toBe(0);
        expect(report.files.percentage).toBe(0);
        expect(report.entities).toHaveLength(0);
    });

    test("calculates route and file percentages", () => {
        const report = buildCoverageReport(
            emptyEntityCoverage(),
            { explored: 3, total: 10 },
            { visited: 7, total: 20 },
        );
        expect(report.routes.percentage).toBe(30);
        expect(report.files.percentage).toBe(35);
    });

    test("includes entity variations with missing values", () => {
        const map = emptyEntityCoverage();
        setPossibleValues(map, "Invoice", "status", ["draft", "sent", "paid"]);
        recordVariation(map, "Invoice", "status", "draft");
        recordEntityTest(map, "Invoice", "t1.md");

        const report = buildCoverageReport(map, { explored: 1, total: 1 }, { visited: 1, total: 1 });
        expect(report.entities).toHaveLength(1);
        expect(report.entities[0]!.name).toBe("Invoice");
        expect(report.entities[0]!.testCount).toBe(1);
        expect(report.entities[0]!.variations[0]!.tested).toEqual(["draft"]);
        expect(report.entities[0]!.variations[0]!.missing).toEqual(["sent", "paid"]);
    });
});

describe("formatCoverageReport", () => {
    test("formats a complete report", () => {
        const map = emptyEntityCoverage();
        setPossibleValues(map, "User", "role", ["admin", "member", "guest"]);
        recordVariation(map, "User", "role", "admin");
        recordEntityTest(map, "User", "t1.md");

        const report = buildCoverageReport(map, { explored: 5, total: 10 }, { visited: 15, total: 30 });
        const text = formatCoverageReport(report);

        expect(text).toContain("Route coverage:   5/10 routes (50%)");
        expect(text).toContain("File coverage:    15/30 source files (50%)");
        expect(text).toContain("1 entity types");
        expect(text).toContain("admin +");
        expect(text).toContain("member -");
        expect(text).toContain("guest -");
    });

    test("formats report with no entities", () => {
        const report = buildCoverageReport(emptyEntityCoverage(), { explored: 0, total: 5 }, { visited: 0, total: 10 });
        const text = formatCoverageReport(report);
        expect(text).not.toContain("Entity coverage");
    });
});
