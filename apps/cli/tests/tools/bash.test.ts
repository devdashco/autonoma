import { describe, expect, test } from "vitest";
import { validateCommand } from "../../src/tools/bash";

const allowed = new Set(["git", "ls", "find", "cat", "head", "tail", "wc", "sort", "diff", "echo"]);

describe("validateCommand", () => {
    test("allows simple commands", () => {
        expect(validateCommand("git status", allowed)).toBeUndefined();
        expect(validateCommand("ls -la", allowed)).toBeUndefined();
        expect(validateCommand("find . -name '*.ts'", allowed)).toBeUndefined();
    });

    test("allows piped commands", () => {
        expect(validateCommand("git log | head -n 10", allowed)).toBeUndefined();
        expect(validateCommand("find . -name '*.ts' | wc -l", allowed)).toBeUndefined();
    });

    test("blocks chaining with semicolons", () => {
        expect(validateCommand("git status; rm -rf /", allowed)).toBeDefined();
    });

    test("blocks chaining with &&", () => {
        expect(validateCommand("git status && rm -rf /", allowed)).toBeDefined();
    });

    test("blocks chaining with ||", () => {
        expect(validateCommand("git status || rm -rf /", allowed)).toBeDefined();
    });

    test("blocks subshells", () => {
        expect(validateCommand("echo $(whoami)", allowed)).toBeDefined();
        expect(validateCommand("echo `whoami`", allowed)).toBeDefined();
    });

    test("blocks redirects", () => {
        expect(validateCommand("echo foo >> /etc/passwd", allowed)).toBeDefined();
    });

    test("blocks disallowed commands", () => {
        const result = validateCommand("rm -rf /", allowed);
        expect(result).toBeDefined();
        expect(result).toContain("rm");
    });

    test("blocks empty commands", () => {
        expect(validateCommand("", allowed)).toBeDefined();
        expect(validateCommand("   ", allowed)).toBeDefined();
    });

    test("validates each segment in a pipe", () => {
        const result = validateCommand("git log | rm -rf /", allowed);
        expect(result).toBeDefined();
        expect(result).toContain("rm");
    });
});
