import { writeFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";

const inputSchema = z.object({
    filePath: z.string().describe("Path to write (absolute or relative to output directory)"),
    content: z.string().describe("File content to write"),
});

export interface WriteFileResult {
    path?: string;
    bytesWritten?: number;
    error?: string;
}

export async function executeWriteFile(
    outputDirectory: string,
    filePath: string,
    content: string,
): Promise<WriteFileResult> {
    const cleaned = filePath.replace(/^autonoma\//, "");
    const absolutePath = resolve(outputDirectory, cleaned);
    const relativePath = relative(outputDirectory, absolutePath);

    if (relativePath.startsWith("..")) {
        return { error: "Cannot write files outside the output directory" };
    }

    try {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content, "utf-8");
        return { path: relativePath, bytesWritten: content.length };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to write file: ${message}` };
    }
}

export function buildWriteFileTool(outputDirectory: string) {
    return tool({
        description: "Write content to a file in the output directory. Creates parent directories as needed.",
        inputSchema,
        execute: (input) => executeWriteFile(outputDirectory, input.filePath, input.content),
    });
}
