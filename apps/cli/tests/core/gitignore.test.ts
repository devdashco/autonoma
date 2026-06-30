import { describe, expect, test } from "vitest";
import { parseGitignore } from "../../src/core/gitignore";

describe("parseGitignore", () => {
    test("parses simple patterns", () => {
        const patterns = parseGitignore("node_modules\ndist\n.env");
        expect(patterns).toContain("**/node_modules");
        expect(patterns).toContain("**/dist");
        expect(patterns).toContain("**/.env");
    });

    test("ignores comments", () => {
        const patterns = parseGitignore("# comment\nnode_modules");
        expect(patterns).toHaveLength(1);
        expect(patterns[0]).toBe("**/node_modules");
    });

    test("ignores blank lines", () => {
        const patterns = parseGitignore("node_modules\n\n\ndist");
        expect(patterns).toHaveLength(2);
    });

    test("handles directory patterns with trailing slash", () => {
        const patterns = parseGitignore("build/");
        expect(patterns).toContain("build/**");
    });

    test("handles rooted patterns with leading slash", () => {
        const patterns = parseGitignore("/dist");
        expect(patterns).toContain("dist");
    });

    test("handles patterns with paths (no globbing needed)", () => {
        const patterns = parseGitignore("src/generated");
        expect(patterns).toContain("src/generated");
    });

    test("handles negation patterns", () => {
        const patterns = parseGitignore("*.log\n!important.log");
        expect(patterns).toContain("**/*.log");
        expect(patterns).toContain("!**/important.log");
    });
});
