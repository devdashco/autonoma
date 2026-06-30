import { describe, expect, test } from "vitest";
import { resolveSandboxedPath, sliceLines } from "../../src/tools/read-file";

describe("resolveSandboxedPath", () => {
    test("allows relative paths within directory", () => {
        const result = resolveSandboxedPath("/project", "src/index.ts");
        expect("error" in result).toBe(false);
        if (!("error" in result)) {
            expect(result.relativePath).toBe("src/index.ts");
        }
    });

    test("blocks paths outside working directory", () => {
        const result = resolveSandboxedPath("/project", "../../etc/passwd");
        expect("error" in result).toBe(true);
    });

    test("resolves absolute paths within directory", () => {
        const result = resolveSandboxedPath("/project", "/project/src/index.ts");
        expect("error" in result).toBe(false);
        if (!("error" in result)) {
            expect(result.relativePath).toBe("src/index.ts");
        }
    });

    test("blocks absolute paths outside directory", () => {
        const result = resolveSandboxedPath("/project", "/etc/passwd");
        expect("error" in result).toBe(true);
    });
});

describe("sliceLines", () => {
    const content = "line1\nline2\nline3\nline4\nline5";

    test("returns all lines with default params", () => {
        const result = sliceLines(content, 0, 100);
        expect(result.totalLines).toBe(5);
        expect(result.linesShown).toBe(5);
        expect(result.startLine).toBe(1);
        expect(result.endLine).toBe(5);
    });

    test("respects offset", () => {
        const result = sliceLines(content, 2, 100);
        expect(result.linesShown).toBe(3);
        expect(result.startLine).toBe(3);
        expect(result.numbered).toContain("3\tline3");
    });

    test("respects limit", () => {
        const result = sliceLines(content, 0, 2);
        expect(result.linesShown).toBe(2);
        expect(result.endLine).toBe(2);
        expect(result.numbered).toContain("1\tline1");
        expect(result.numbered).toContain("2\tline2");
        expect(result.numbered).not.toContain("3\t");
    });

    test("handles offset + limit together", () => {
        const result = sliceLines(content, 1, 2);
        expect(result.linesShown).toBe(2);
        expect(result.startLine).toBe(2);
        expect(result.endLine).toBe(3);
    });

    test("handles empty content", () => {
        const result = sliceLines("", 0, 100);
        expect(result.totalLines).toBe(1);
        expect(result.linesShown).toBe(1);
    });
});
