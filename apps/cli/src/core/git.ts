import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_INFO_FILE = ".git-info.json";

export interface GitInfo {
    /** Full HEAD commit SHA at the time analysis started. */
    sha: string;
    /** Current branch name, or "HEAD" when detached. */
    branch?: string;
    /** True when the working tree had uncommitted changes (so the SHA doesn't fully represent the analyzed state). */
    dirty: boolean;
}

async function git(projectRoot: string, args: string[]): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync("git", args, { cwd: projectRoot });
        return stdout.trim();
    } catch {
        // Not a git repo, git not installed, or detached/empty - treat as "no git".
        return undefined;
    }
}

/**
 * Reads the current commit, branch, and dirty state of the project's git repo.
 * Returns undefined when the project is not a git repository (or git is
 * unavailable) - the caller should just skip recording commit info in that case.
 */
export async function readGitInfo(projectRoot: string): Promise<GitInfo | undefined> {
    const sha = await git(projectRoot, ["rev-parse", "HEAD"]);
    if (sha == null || sha.length === 0) return undefined;

    const branch = await git(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const status = await git(projectRoot, ["status", "--porcelain"]);

    return {
        sha,
        branch: branch != null && branch.length > 0 ? branch : undefined,
        dirty: status != null && status.length > 0,
    };
}

export async function saveGitInfo(outputDir: string, info: GitInfo): Promise<void> {
    await writeFile(join(outputDir, GIT_INFO_FILE), JSON.stringify(info, null, 2), "utf-8");
}

export async function loadGitInfo(outputDir: string): Promise<GitInfo | undefined> {
    try {
        const raw = await readFile(join(outputDir, GIT_INFO_FILE), "utf-8");
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "object" && parsed != null && "sha" in parsed && typeof parsed.sha === "string") {
            const branch = "branch" in parsed && typeof parsed.branch === "string" ? parsed.branch : undefined;
            const dirty = "dirty" in parsed && typeof parsed.dirty === "boolean" ? parsed.dirty : false;
            return { sha: parsed.sha, branch, dirty };
        }
        return undefined;
    } catch {
        return undefined;
    }
}
