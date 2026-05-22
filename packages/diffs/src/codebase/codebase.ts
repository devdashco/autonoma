import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { promisify } from "node:util";
import type { GitHubInstallationClient } from "@autonoma/github";
import { type Logger, logger as rootLogger } from "@autonoma/logger";

const execFileAsync = promisify(execFile);

export interface ReadFileOptions {
    startLine?: number;
    endLine?: number;
}

export interface GrepOptions {
    glob?: string;
    maxResults?: number;
}

export interface GrepHit {
    path: string;
    line: number;
    match: string;
}

export interface DirectoryEntry {
    name: string;
    type: "file" | "directory";
}

const DEFAULT_GREP_LIMIT = 200;

/**
 * "The user's source tree at a specific commit", with a small read API.
 *
 * Get one via `Codebase.clone(...)`, or construct directly
 * (`new Codebase(path)`) when you already have a populated tree (tests,
 * etc.). Reuse across multiple operations is the default; call `dispose()`
 * explicitly if you want the directory removed.
 *
 * Paths passed to `readFile` / `listDirectory` are resolved relative to
 * `root` for convenience but are otherwise unconstrained: the reviewer
 * agent is trusted internal code reading the user's own repo, so we don't
 * sandbox traversal, symlinks, or absolute paths. If the agent asks for
 * `/etc/passwd` it'll get whatever `fs.readFile` returns - same as if you
 * called `fs.readFile` yourself.
 */
export class Codebase {
    private readonly logger: Logger;

    constructor(public readonly root: string) {
        this.logger = rootLogger.child({ name: this.constructor.name, root });
    }

    /**
     * Shells out to `cloneRepository()` from `@autonoma/github` and returns a
     * `Codebase` rooted at `targetDir`. Throws on any failure (and removes the
     * partially-populated `targetDir` first). Caller owns the lifecycle - call
     * `dispose()` when done.
     */
    static async clone(
        githubClient: GitHubInstallationClient,
        targetDir: string,
        opts: { repoName: string; commitSha: string; baseSha?: string },
    ): Promise<Codebase> {
        const logger = rootLogger.child({
            name: "Codebase.clone",
            repoName: opts.repoName,
            commitSha: opts.commitSha,
            targetDir,
        });
        logger.info("Cloning repository for codebase access");
        try {
            await githubClient.cloneRepository({
                fullName: opts.repoName,
                headSha: opts.commitSha,
                baseSha: opts.baseSha,
                targetDir,
            });
        } catch (error) {
            await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
            throw error;
        }
        return new Codebase(targetDir);
    }

    /** Remove the on-disk directory. Explicit, never auto-called. */
    async dispose(): Promise<void> {
        this.logger.info("Disposing codebase clone");
        await fs.rm(this.root, { recursive: true, force: true });
    }

    async readFile(path: string, options: ReadFileOptions = {}): Promise<string> {
        const absPath = resolvePath(this.root, path);
        const content = await fs.readFile(absPath, "utf-8");

        if (options.startLine == null && options.endLine == null) return content;

        const lines = content.split("\n");
        const start = Math.max(1, options.startLine ?? 1) - 1;
        const end = Math.min(lines.length, options.endLine ?? lines.length);
        return lines.slice(start, end).join("\n");
    }

    async grep(pattern: string, options: GrepOptions = {}): Promise<GrepHit[]> {
        const limit = options.maxResults ?? DEFAULT_GREP_LIMIT;
        const args = ["grep", "-n", "--no-color", "-I", "-e", pattern];
        if (options.glob != null) {
            args.push("--", options.glob);
        }

        try {
            const { stdout } = await execFileAsync("git", args, {
                cwd: this.root,
                maxBuffer: 5 * 1024 * 1024,
                timeout: 30_000,
            });
            return this.parseGrep(stdout, limit);
        } catch (error) {
            // git grep exits 1 when there are no matches; treat that as empty result, not failure.
            if (isExitOne(error)) return [];
            throw error;
        }
    }

    async listDirectory(path = "."): Promise<DirectoryEntry[]> {
        const absPath = resolvePath(this.root, path);
        const entries = await fs.readdir(absPath, { withFileTypes: true });
        return entries
            .filter((e) => e.name !== ".git")
            .map((e) => ({
                name: e.name,
                type: e.isDirectory() ? ("directory" as const) : ("file" as const),
            }));
    }

    private parseGrep(stdout: string, limit: number): GrepHit[] {
        const hits: GrepHit[] = [];
        const lines = stdout.split("\n");
        for (const raw of lines) {
            if (raw.length === 0) continue;
            const colonOne = raw.indexOf(":");
            const colonTwo = raw.indexOf(":", colonOne + 1);
            if (colonOne === -1 || colonTwo === -1) continue;
            const path = raw.slice(0, colonOne);
            const lineNum = Number.parseInt(raw.slice(colonOne + 1, colonTwo), 10);
            const match = raw.slice(colonTwo + 1);
            if (Number.isNaN(lineNum)) continue;
            hits.push({ path, line: lineNum, match });
            if (hits.length >= limit) break;
        }
        return hits;
    }
}

function isExitOne(error: unknown): boolean {
    if (error == null || typeof error !== "object") return false;
    const code = (error as { code?: unknown }).code;
    return code === 1;
}
