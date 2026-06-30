import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { slugify, getOutputDir } from "../../src/core/output";

describe("slugify", () => {
    test("lowercases and replaces non-alphanumeric", () => {
        expect(slugify("My Project")).toBe("my-project");
    });

    test("trims leading/trailing dashes", () => {
        expect(slugify("--hello-world--")).toBe("hello-world");
    });

    test("collapses multiple dashes", () => {
        expect(slugify("a   b   c")).toBe("a-b-c");
    });

    test("handles special characters", () => {
        expect(slugify("Project (v2) @latest!")).toBe("project-v2-latest");
    });

    test("handles empty string", () => {
        expect(slugify("")).toBe("");
    });
});

describe("getOutputDir", () => {
    test("returns path under ~/.autonoma", () => {
        const dir = getOutputDir("my-project");
        expect(dir).toBe(join(homedir(), ".autonoma", "my-project"));
    });
});
