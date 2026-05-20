import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";

const fileRequestSchema = z.object({
    filePath: z.string().describe("The path to the file to read (absolute or relative to working directory)"),
    offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Line number to start reading from (0-based). Omit to start from the beginning."),
    limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Maximum number of lines to read. Omit to read the entire file."),
});

const readFilesSchema = z.object({
    files: z
        .array(fileRequestSchema)
        .min(1)
        .describe(
            "List of files to read. Pass every file you need in a single call rather than calling this tool one path at a time.",
        ),
});

const MAX_LINES = 2000;

type FileSuccess = {
    path: string;
    content: string;
    totalLines: number;
    linesShown: number;
    startLine: number;
    endLine: number;
};

type FileResult = FileSuccess | { error: string };

async function readSingleFile(workingDirectory: string, input: z.infer<typeof fileRequestSchema>): Promise<FileResult> {
    const absolutePath = resolve(workingDirectory, input.filePath);
    const relativePath = relative(workingDirectory, absolutePath);

    if (relativePath.startsWith("..")) {
        return { error: "Cannot read files outside the working directory" };
    }

    try {
        const content = await readFile(absolutePath, "utf-8");
        const allLines = content.split("\n");

        const offset = input.offset ?? 0;
        const limit = input.limit ?? MAX_LINES;
        const lines = allLines.slice(offset, offset + limit);

        const numberedLines = lines.map((line: string, i: number) => `${offset + i + 1}\t${line}`).join("\n");

        return {
            path: relativePath,
            content: numberedLines,
            totalLines: allLines.length,
            linesShown: lines.length,
            startLine: offset + 1,
            endLine: offset + lines.length,
        };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

export function buildReadFileTool(workingDirectory: string) {
    return tool({
        description:
            "Read the contents of one or more files in a single call. " +
            "Pass every file you need in the `files` array - do not call this tool repeatedly for individual paths. " +
            "Returns a `results` object keyed by the requested filePath. " +
            "For large files, use offset and limit per entry to read specific sections.",
        inputSchema: readFilesSchema,
        execute: async ({ files }) => {
            const entries = await Promise.all(
                files.map(async (file) => [file.filePath, await readSingleFile(workingDirectory, file)] as const),
            );
            const results: Record<string, FileResult> = {};
            for (const [filePath, result] of entries) {
                results[filePath] = result;
            }
            return { results };
        },
    });
}
