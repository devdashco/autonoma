import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { readExecError } from "../core/exec-error";

const execFileAsync = promisify(execFile);

const inputSchema = z.object({
    pattern: z.string().describe("Regex pattern to search for in file contents"),
    glob: z.string().optional().describe("Glob to filter files (e.g. '*.ts')"),
    path: z.string().optional().describe("File or directory to search in"),
});

export function buildGrepTool(workingDirectory: string) {
    return tool({
        description: "Search file contents with ripgrep. Returns matching lines with file paths and line numbers.",
        inputSchema,
        execute: async (input) => {
            const args = [
                "--no-heading",
                "--line-number",
                "--max-count=50",
                "--glob=!node_modules",
                "--glob=!dist",
                "--glob=!.git",
            ];

            if (input.glob != null) {
                args.push(`--glob=${input.glob}`);
            }

            args.push(input.pattern);
            args.push(input.path ?? workingDirectory);

            try {
                const { stdout } = await execFileAsync("rg", args, {
                    cwd: workingDirectory,
                    maxBuffer: 1024 * 1024,
                });

                const lines = stdout.trim().split("\n").filter(Boolean);
                return { matches: lines, count: lines.length };
            } catch (error) {
                const execError = readExecError(error);
                if (execError.code === 1) {
                    return { matches: [], count: 0 };
                }
                const message = error instanceof Error ? error.message : String(error);
                return { error: `Grep failed: ${message}`, matches: [], count: 0 };
            }
        },
    });
}
