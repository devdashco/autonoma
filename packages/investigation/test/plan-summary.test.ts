import { describe, expect, it } from "vitest";
import { planSummary } from "../src/plan-summary";

describe("planSummary", () => {
    it("returns a sentinel for a missing plan", () => {
        expect(planSummary(undefined)).toBe("(no plan)");
    });

    it("returns a sentinel when there is no usable frontmatter", () => {
        expect(planSummary("# Test\n## Steps\n1. click login")).toBe("(no description)");
    });

    it("uses the frontmatter description", () => {
        expect(planSummary("---\ndescription: signs a user in\n---\n# Test")).toBe("signs a user in");
    });

    it("joins description and intent when both are present", () => {
        const plan = "---\ndescription: signs a user in\nintent: verify auth works\n---";
        expect(planSummary(plan)).toBe("signs a user in - verify auth works");
    });

    it("strips surrounding quotes from frontmatter values", () => {
        expect(planSummary(`---\ndescription: "quoted summary"\n---`)).toBe("quoted summary");
    });
});
