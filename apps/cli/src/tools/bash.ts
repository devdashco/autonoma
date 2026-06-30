import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { readExecError } from "../core/exec-error";

const execFileAsync = promisify(execFile);

const CHAINING_OPERATORS = /;|&&|\|\||`|\$\(|>>|<<|&\s*$/;

const DEFAULT_ALLOWED = new Set(["git", "wc", "sort", "head", "tail", "cat", "ls", "find", "diff", "echo"]);

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 512;

const inputSchema = z.object({
    command: z.string().describe("Shell command to execute"),
});

interface BashResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export function validateCommand(command: string, allowed: Set<string>): string | undefined {
    const trimmed = command.trim();
    if (trimmed.length === 0) return "Empty command";

    if (CHAINING_OPERATORS.test(trimmed)) {
        return "Command chaining (;, &&, ||), subshells, and redirects are not allowed. Use pipes (|) instead.";
    }

    const segments = trimmed.split(/\s*\|\s*/);
    for (const segment of segments) {
        const binary = segment.trim().split(/\s+/)[0];
        if (binary == null || !allowed.has(binary)) {
            return `Command "${binary ?? ""}" is not allowed. Allowed: ${[...allowed].join(", ")}`;
        }
    }

    return undefined;
}

export function buildBashTool(workingDirectory: string, allowedCommands?: Set<string>) {
    const allowed = allowedCommands ?? DEFAULT_ALLOWED;

    return tool({
        description:
            "Execute a shell command. Primarily for git, ls, find, and basic unix utilities. " +
            "Pipes allowed; chaining (;, &&, ||) is not.",
        inputSchema,
        execute: async (input): Promise<BashResult> => {
            const error = validateCommand(input.command, allowed);
            if (error != null) {
                return { exitCode: 1, stdout: "", stderr: error };
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
            } catch (err) {
                const execErr = readExecError(err);

                if (execErr.killed) {
                    return {
                        exitCode: 1,
                        stdout: "",
                        stderr: `Command timed out after ${TIMEOUT_MS / 1000}s`,
                    };
                }

                return {
                    exitCode: execErr.code ?? 1,
                    stdout: execErr.stdout?.trimEnd() ?? "",
                    stderr: execErr.stderr?.trimEnd() ?? "",
                };
            }
        },
    });
}
