import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Codebase } from "@autonoma/diffs";
import { type GitHubApp, OctokitGitHubApp } from "@autonoma/github";
import { type Logger, logger as rootLogger } from "@autonoma/logger";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default on-disk repo cache, gitignored, shared across every eval run in this app. */
const DEFAULT_CACHE_ROOT = path.resolve(__dirname, "..", ".cache", "repos");

/**
 * The git coordinates of a frozen eval case, stored in `input.json` in place of
 * the live {@link Codebase}. `ensureCachedCheckout` rehydrates a real clone from
 * these at run time. Both `baseSha` and `headSha` must be reachable so the
 * analysis agent can diff `base..head`.
 */
export const codebaseCoordsSchema = z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    /** GitHub App installation id used to mint a token for the clone/fetch. */
    installationId: z.number().int().positive(),
    baseSha: z.string().min(1),
    headSha: z.string().min(1),
});

export type CodebaseCoords = z.infer<typeof codebaseCoordsSchema>;

/**
 * Thrown when a commit cannot be fetched from the remote - typically because it
 * was force-pushed away or its branch was deleted. Capture refuses to freeze a
 * case in this state; the eval suite skips such a case with a warning rather
 * than red-failing.
 */
export class UnfetchableShaError extends Error {
    constructor(
        public readonly sha: string,
        public readonly repoFullName: string,
        options?: { cause?: unknown },
    ) {
        super(
            `Commit ${sha} is not fetchable from ${repoFullName} (it may have been force-pushed away or its branch deleted)`,
            options,
        );
        this.name = "UnfetchableShaError";
    }
}

export interface EnsureCachedCheckoutOptions {
    /** Override the cache root (defaults to a gitignored dir under `evals/.cache/repos`). */
    cacheRoot?: string;
    /** Override the GitHub App (defaults to one built from this app's env). */
    githubApp?: GitHubApp;
    logger?: Logger;
}

let githubAppSingleton: GitHubApp | undefined;

/**
 * Build the default GitHub App from this app's env, lazily and via dynamic
 * import. Deferring the import means the env (which requires the GITHUB_APP_*
 * credentials) is only validated when a token actually has to be minted - so an
 * eval over a public repo, or one whose SHAs are already cached, runs with no
 * GitHub credentials at all.
 */
async function loadDefaultGithubApp(): Promise<GitHubApp> {
    if (githubAppSingleton == null) {
        const { env } = await import("../../src/env");
        githubAppSingleton = new OctokitGitHubApp({
            appId: env.GITHUB_APP_ID,
            privateKey: env.GITHUB_APP_PRIVATE_KEY,
            webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
            appSlug: env.GITHUB_APP_SLUG,
        });
    }
    return githubAppSingleton;
}

/**
 * Rehydrate a {@link Codebase} from git coordinates against a persistent,
 * gitignored repo cache.
 *
 * Clone-once-then-fetch: the first time a repo is seen it is cloned into the
 * cache; subsequent runs only `git fetch` the needed commits and `git checkout`
 * the head SHA. A fresh App installation token is minted lazily - only when a
 * clone or fetch actually needs the network - and used inline, never persisted
 * into the clone's git config. A repo whose SHAs are already cached needs no
 * token at all, and public repos work unauthenticated.
 *
 * After this resolves, `baseSha` and `headSha` are both reachable in the
 * returned codebase, so `base..head` diffing works. Throws
 * {@link UnfetchableShaError} if either SHA cannot be fetched.
 *
 * The caller must NOT `dispose()` the returned codebase - the working tree is
 * shared across cases, so the suite must run sequentially.
 */
export async function ensureCachedCheckout(
    coords: CodebaseCoords,
    options: EnsureCachedCheckoutOptions = {},
): Promise<Codebase> {
    const { owner, repo, installationId, baseSha, headSha } = coords;
    const repoFullName = `${owner}/${repo}`;
    const cacheRoot = options.cacheRoot ?? DEFAULT_CACHE_ROOT;
    const repoDir = path.join(cacheRoot, `${owner}__${repo}`);
    const logger = (options.logger ?? rootLogger).child({ name: "ensureCachedCheckout" });

    logger.info("Ensuring cached checkout", { extra: { repoFullName, repoDir, baseSha, headSha } });

    const publicUrl = `https://github.com/${repoFullName}.git`;

    // Mint the App token lazily and at most once: a cached repo whose SHAs are
    // already present needs no network at all, and public repos clone/fetch
    // unauthenticated. Falls back to the public URL if a token can't be minted.
    const getCloneUrl = memoizedCloneUrl({
        githubApp: options.githubApp,
        installationId,
        repoFullName,
        publicUrl,
        logger,
    });

    if (!existsSync(path.join(repoDir, ".git"))) {
        await cloneInto({ repoDir, getCloneUrl, publicUrl, logger });
    } else {
        logger.info("Reusing existing clone");
    }

    await fetchSha({ repoDir, getCloneUrl, sha: headSha, repoFullName, logger });
    await fetchSha({ repoDir, getCloneUrl, sha: baseSha, repoFullName, logger });

    logger.info("Checking out head SHA", { extra: { headSha } });
    await git(repoDir, ["checkout", "--force", "--detach", headSha]);

    await assertReachable({ repoDir, sha: baseSha, repoFullName });

    logger.info("Cached checkout ready");
    return new Codebase(repoDir);
}

/** Lazily resolve the URL to clone/fetch from, minting an App token once and caching the result. */
function memoizedCloneUrl(deps: {
    githubApp?: GitHubApp;
    installationId: number;
    repoFullName: string;
    publicUrl: string;
    logger: Logger;
}): () => Promise<string> {
    let resolved: string | undefined;
    return async () => {
        if (resolved != null) return resolved;
        try {
            const githubApp = deps.githubApp ?? (await loadDefaultGithubApp());
            const client = await githubApp.getInstallationClient(deps.installationId);
            const token = await client.getInstallationToken();
            resolved = `https://x-access-token:${token}@github.com/${deps.repoFullName}.git`;
        } catch (err) {
            deps.logger.warn("Could not mint installation token; using unauthenticated access (public repos only)", {
                extra: { repoFullName: deps.repoFullName, err },
            });
            resolved = deps.publicUrl;
        }
        return resolved;
    };
}

async function cloneInto(params: {
    repoDir: string;
    getCloneUrl: () => Promise<string>;
    publicUrl: string;
    logger: Logger;
}): Promise<void> {
    const { repoDir, getCloneUrl, publicUrl, logger } = params;
    logger.info("Cloning repository into cache (first run)");
    const cloneUrl = await getCloneUrl();
    // Clone with the (possibly authed) URL, then immediately scrub any token out
    // of the persisted remote config - later fetches pass the URL inline.
    await execFileAsync("git", ["clone", "--no-tags", cloneUrl, repoDir], {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 300_000,
    });
    await git(repoDir, ["remote", "set-url", "origin", publicUrl]);
}

async function fetchSha(params: {
    repoDir: string;
    getCloneUrl: () => Promise<string>;
    sha: string;
    repoFullName: string;
    logger: Logger;
}): Promise<void> {
    const { repoDir, getCloneUrl, sha, repoFullName, logger } = params;

    // Already present (e.g. fetched on a previous run) - skip the network call.
    if (await isReachable(repoDir, sha)) {
        logger.info("Commit already present in cache", { extra: { sha } });
        return;
    }

    logger.info("Fetching commit", { extra: { sha } });
    try {
        const fetchUrl = await getCloneUrl();
        await execFileAsync("git", ["fetch", "--no-tags", fetchUrl, sha], {
            cwd: repoDir,
            maxBuffer: 50 * 1024 * 1024,
            timeout: 120_000,
        });
    } catch (error) {
        throw new UnfetchableShaError(sha, repoFullName, { cause: error });
    }
}

async function assertReachable(params: { repoDir: string; sha: string; repoFullName: string }): Promise<void> {
    const { repoDir, sha, repoFullName } = params;
    if (!(await isReachable(repoDir, sha))) {
        throw new UnfetchableShaError(sha, repoFullName);
    }
}

async function isReachable(repoDir: string, sha: string): Promise<boolean> {
    try {
        const { stdout } = await execFileAsync("git", ["cat-file", "-t", sha], { cwd: repoDir });
        return stdout.trim() === "commit";
    } catch {
        return false;
    }
}

async function git(repoDir: string, args: string[]): Promise<void> {
    await execFileAsync("git", args, { cwd: repoDir, maxBuffer: 50 * 1024 * 1024, timeout: 120_000 });
}
