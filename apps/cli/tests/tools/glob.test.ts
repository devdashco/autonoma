import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { executeGlob } from "../../src/tools/glob";

describe("executeGlob", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "test-glob-"));
        await mkdir(join(tempDir, "src"), { recursive: true });
        await mkdir(join(tempDir, "node_modules/pkg"), { recursive: true });
        await writeFile(join(tempDir, "src/index.ts"), "export {}");
        await writeFile(join(tempDir, "src/utils.ts"), "export {}");
        await writeFile(join(tempDir, "node_modules/pkg/index.js"), "module.exports = {}");
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true });
    });

    test("finds files by pattern", async () => {
        const result = await executeGlob("**/*.ts", tempDir);
        expect(result.count).toBe(2);
        expect(result.matches).toContain("src/index.ts");
        expect(result.matches).toContain("src/utils.ts");
    });

    test("ignores node_modules by default", async () => {
        const result = await executeGlob("**/*.js", tempDir);
        expect(result.count).toBe(0);
    });

    test("respects custom ignore patterns", async () => {
        const result = await executeGlob("**/*.ts", tempDir, ["**/utils.*"]);
        expect(result.count).toBe(1);
        expect(result.matches).toContain("src/index.ts");
    });
});
