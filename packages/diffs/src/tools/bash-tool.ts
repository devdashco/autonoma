import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const ALLOWED_COMMANDS = new Set(["git", "wc", "sort", "head", "tail", "cat", "ls", "find", "diff"]);

const CHAINING_OPERATORS = /;|&&|\|\||`|\$\(|>>|<<|&\s*$/;

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 512;

const bashSchema = z.object({
    command: z.string().describe("The shell command to execute. Primarily intended for git operations."),
});

type BashResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
};

function blockResult(message: string): BashResult {
    return { exitCode: 1, stdout: "", stderr: message };
}

export function validateCommand(command: string): string | undefined {
    const trimmed = command.trim();
    if (trimmed.length === 0) {
        return "Empty command is not allowed.";
    }

    if (CHAINING_OPERATORS.test(trimmed)) {
        return "Command chaining (;, &&, ||), subshells ($(), ``), and redirects (>>, <<) are not allowed. Use pipes (|) to combine allowed commands.";
    }

    const segments = trimmed.split(/\s*\|\s*/);

    for (const segment of segments) {
        const binary = segment.trim().split(/\s+/)[0];
        if (binary == null || !ALLOWED_COMMANDS.has(binary)) {
            return `Command "${binary ?? ""}" is not allowed. Allowed commands: ${[...ALLOWED_COMMANDS].join(", ")}`;
        }
    }

    return undefined;
}

export function buildBashTool(workingDirectory: string) {
    return tool({
        description:
            "Execute a shell command in the working directory. " +
            "Primarily intended for git operations (git diff, git log, git status, git show, etc.) " +
            "and basic unix utilities (wc, sort, head, tail, ls, find, diff). " +
            "Commands can be piped together (e.g. git log | head -n 10) but chaining with ; && || is not allowed. " +
            "Do not use this for file reading (use read_files) or searching (use grep/glob).",
        inputSchema: bashSchema,
        execute: async (input) => {
            const validationError = validateCommand(input.command);
            if (validationError != null) {
                return blockResult(validationError);
            }

            try {
                const { stdout, stderr } = await execFileAsync("sh", ["-c", input.command], {
                    cwd: workingDirectory,
                    maxBuffer: MAX_OUTPUT_BYTES,
                    timeout: TIMEOUT_MS,
                });

                return {
                    exitCode: 0,
                    stdout: stdout.trimEnd(),
                    stderr: stderr.trimEnd(),
                };
            } catch (error) {
                const execError = error as { code?: number; stdout?: string; stderr?: string; killed?: boolean };

                if (execError.killed === true) {
                    return blockResult(`Command timed out after ${TIMEOUT_MS / 1000}s`);
                }

                return {
                    exitCode: typeof execError.code === "number" ? execError.code : 1,
                    stdout: execError.stdout?.trimEnd() ?? "",
                    stderr: execError.stderr?.trimEnd() ?? "",
                };
            }
        },
    });
}
