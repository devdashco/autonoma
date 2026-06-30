import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { executeWriteFile } from "../../src/tools/write-file";

describe("executeWriteFile", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "test-write-"));
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true });
    });

    test("writes file to output directory", async () => {
        const result = await executeWriteFile(tempDir, "test.txt", "hello world");
        expect(result.error).toBeUndefined();
        expect(result.path).toBe("test.txt");
        expect(result.bytesWritten).toBe(11);

        const content = await readFile(join(tempDir, "test.txt"), "utf-8");
        expect(content).toBe("hello world");
    });

    test("creates nested directories", async () => {
        const result = await executeWriteFile(tempDir, "a/b/c/test.txt", "nested");
        expect(result.error).toBeUndefined();
        expect(result.path).toBe("a/b/c/test.txt");

        const content = await readFile(join(tempDir, "a/b/c/test.txt"), "utf-8");
        expect(content).toBe("nested");
    });

    test("blocks paths outside output directory", async () => {
        const result = await executeWriteFile(tempDir, "../../etc/passwd", "pwned");
        expect(result.error).toBeDefined();
        expect(result.error).toContain("outside");
    });
});
