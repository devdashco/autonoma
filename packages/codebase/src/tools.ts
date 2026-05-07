import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { Codebase } from "./codebase";

const MAX_TOOL_OUTPUT_CHARS = 60_000;

/**
 * AI SDK tools backed by a Codebase. Reviewers spread these into their tool
 * registry alongside the kernel's screenshot tools.
 */
export function buildCodebaseTools(codebase: Codebase): ToolSet {
    return {
        read_file: tool({
            description:
                "Read a file from the application's source tree. Provide a path relative to the repository root. Optionally pass startLine/endLine (1-indexed, inclusive) to fetch a slice.",
            inputSchema: z.object({
                path: z.string().describe("Path relative to the repository root, e.g. 'src/components/Login.tsx'"),
                startLine: z.number().int().min(1).optional(),
                endLine: z.number().int().min(1).optional(),
            }),
            execute: async ({ path, startLine, endLine }) => {
                try {
                    const content = await codebase.readFile(path, { startLine, endLine });
                    return { ok: true as const, content: truncate(content) };
                } catch (error) {
                    return { ok: false as const, error: errorMessage(error) };
                }
            },
        }),

        grep: tool({
            description:
                "Search the application's source tree for a regular expression (uses git grep). Returns up to 200 matches with file paths and line numbers.",
            inputSchema: z.object({
                pattern: z.string().describe("Regular expression to search for"),
                glob: z.string().optional().describe("Optional glob to restrict the search, e.g. 'src/**/*.tsx'"),
                maxResults: z.number().int().min(1).max(500).optional(),
            }),
            execute: async ({ pattern, glob, maxResults }) => {
                try {
                    const hits = await codebase.grep(pattern, { glob, maxResults });
                    return { ok: true as const, hits };
                } catch (error) {
                    return { ok: false as const, error: errorMessage(error) };
                }
            },
        }),

        list_directory: tool({
            description: "List entries in a directory inside the application's source tree.",
            inputSchema: z.object({
                path: z.string().default(".").describe("Path relative to the repository root. Defaults to the root."),
            }),
            execute: async ({ path }) => {
                try {
                    const entries = await codebase.listDirectory(path);
                    return { ok: true as const, entries };
                } catch (error) {
                    return { ok: false as const, error: errorMessage(error) };
                }
            },
        }),
    };
}

function truncate(content: string): string {
    if (content.length <= MAX_TOOL_OUTPUT_CHARS) return content;
    return `${content.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n\n[...truncated, file is longer than ${MAX_TOOL_OUTPUT_CHARS} chars; request specific line ranges to see more]`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
