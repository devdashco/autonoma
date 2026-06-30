import { tool } from "ai";
import { glob } from "glob";
import { z } from "zod";

const inputSchema = z.object({
    pattern: z.string().describe("Glob pattern to match files (e.g. '**/*.ts', 'src/**/*.py')"),
    cwd: z.string().optional().describe("Directory to search in. Defaults to working directory."),
});

const DEFAULT_IGNORE = ["**/node_modules/**", "**/dist/**", "**/.git/**"];

export interface GlobResult {
    matches: string[];
    count: number;
    error?: string;
}

export async function executeGlob(
    pattern: string,
    cwd: string,
    ignorePatterns: string[] = DEFAULT_IGNORE,
): Promise<GlobResult> {
    try {
        const matches = await glob(pattern, {
            cwd,
            nodir: true,
            ignore: ignorePatterns,
        });
        return { matches, count: matches.length };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Glob failed: ${message}`, matches: [], count: 0 };
    }
}

export function buildGlobTool(workingDirectory: string, ignorePatterns?: string[]) {
    const ignore = ignorePatterns ?? DEFAULT_IGNORE;

    return tool({
        description: "Find files matching a glob pattern. Returns paths relative to working directory.",
        inputSchema,
        execute: (input) => executeGlob(input.pattern, input.cwd ?? workingDirectory, ignore),
    });
}
