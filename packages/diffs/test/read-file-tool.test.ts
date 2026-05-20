import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildReadFileTool } from "../src/tools/read-file-tool";
import { executeTool } from "./execute-tool";
import { type TestFixture, createTestFixture } from "./setup-fixture";

interface ReadFileSuccess {
    path: string;
    content: string;
    totalLines: number;
    linesShown: number;
    startLine: number;
    endLine: number;
}

interface ReadFileError {
    error: string;
}

type ReadFilesResult = {
    results: Record<string, ReadFileSuccess | ReadFileError>;
};

function expectSuccess(result: ReadFileSuccess | ReadFileError | undefined): ReadFileSuccess {
    if (result == null || "error" in result) {
        throw new Error(`Expected success, got: ${JSON.stringify(result)}`);
    }
    return result;
}

describe("read_files tool", () => {
    let fixture: TestFixture;
    let readFiles: ReturnType<typeof buildReadFileTool>;

    beforeAll(async () => {
        fixture = await createTestFixture();
        readFiles = buildReadFileTool(fixture.workingDirectory);
    });

    afterAll(async () => {
        await fixture.cleanup();
    });

    it("reads a file with line numbers", async () => {
        const result = await executeTool<ReadFilesResult>(readFiles, {
            files: [{ filePath: "src/math.ts" }],
        });
        const entry = expectSuccess(result.results["src/math.ts"]);

        expect(entry.path).toBe("src/math.ts");
        expect(entry.content).toContain("export function add");
        expect(entry.content).toContain("export function subtract");
        expect(entry.totalLines).toBe(8);
        expect(entry.linesShown).toBe(8);
        expect(entry.startLine).toBe(1);
        expect(entry.endLine).toBe(8);
    });

    it("prepends line numbers to each line", async () => {
        const result = await executeTool<ReadFilesResult>(readFiles, {
            files: [{ filePath: "src/math.ts" }],
        });
        const entry = expectSuccess(result.results["src/math.ts"]);
        const lines = entry.content.split("\n");

        expect(lines[0]).toMatch(/^1\t/);
        expect(lines[1]).toMatch(/^2\t/);
    });

    it("reads a file with offset", async () => {
        const result = await executeTool<ReadFilesResult>(readFiles, {
            files: [{ filePath: "src/math.ts", offset: 4 }],
        });
        const entry = expectSuccess(result.results["src/math.ts"]);

        expect(entry.startLine).toBe(5);
        expect(entry.content).toContain("export function subtract");
        expect(entry.content).not.toContain("export function add");
    });

    it("reads a file with limit", async () => {
        const result = await executeTool<ReadFilesResult>(readFiles, {
            files: [{ filePath: "src/math.ts", limit: 3 }],
        });
        const entry = expectSuccess(result.results["src/math.ts"]);

        expect(entry.linesShown).toBe(3);
        expect(entry.startLine).toBe(1);
        expect(entry.endLine).toBe(3);
        expect(entry.totalLines).toBe(8);
    });

    it("reads a file with both offset and limit", async () => {
        const result = await executeTool<ReadFilesResult>(readFiles, {
            files: [{ filePath: "src/math.ts", offset: 1, limit: 2 }],
        });
        const entry = expectSuccess(result.results["src/math.ts"]);

        expect(entry.startLine).toBe(2);
        expect(entry.endLine).toBe(3);
        expect(entry.linesShown).toBe(2);
    });

    it("reads multiple files in a single call, keyed by requested path", async () => {
        const result = await executeTool<ReadFilesResult>(readFiles, {
            files: [{ filePath: "src/math.ts" }, { filePath: "src/utils/logger.ts" }],
        });

        const math = expectSuccess(result.results["src/math.ts"]);
        const logger = expectSuccess(result.results["src/utils/logger.ts"]);
        expect(math.content).toContain("export function add");
        expect(logger.content).toContain("class Logger");
    });

    it("rejects paths outside the working directory per-entry without failing the batch", async () => {
        const result = await executeTool<ReadFilesResult>(readFiles, {
            files: [{ filePath: "../../etc/passwd" }, { filePath: "src/math.ts" }],
        });

        const denied = result.results["../../etc/passwd"] as ReadFileError;
        expect(denied.error).toBe("Cannot read files outside the working directory");
        const math = expectSuccess(result.results["src/math.ts"]);
        expect(math.content).toContain("export function add");
    });

    it("accepts absolute paths within the working directory", async () => {
        const absolute = `${fixture.workingDirectory}/src/math.ts`;
        const result = await executeTool<ReadFilesResult>(readFiles, {
            files: [{ filePath: absolute }],
        });
        const entry = expectSuccess(result.results[absolute]);

        expect(entry.path).toBe("src/math.ts");
        expect(entry.content).toContain("export function add");
    });
});
