import { type GitHubPrCommentKind, type PrismaClient, withAdvisoryLock } from "@autonoma/db";
import type { GitHubCommentStore } from "./types";

// Backs a GitHubCommentStore with the shared `github_pr_comment` table, keyed by (repo, pr, kind).
// `runExclusive` serializes the read-post-persist section across processes with a Postgres advisory
// lock so two concurrent first-time completions cannot both post before either persists its id.
export function createGitHubPrCommentStore(db: PrismaClient, kind: GitHubPrCommentKind): GitHubCommentStore {
    return {
        async getState(repoFullName, prNumber) {
            const comment = await db.gitHubPrComment.findUnique({
                where: { repoFullName_prNumber_kind: { repoFullName, prNumber, kind } },
                select: { commentId: true, headSha: true },
            });
            return comment ?? null;
        },
        async setCommentId(repoFullName, prNumber, commentId, headSha) {
            await db.gitHubPrComment.upsert({
                where: { repoFullName_prNumber_kind: { repoFullName, prNumber, kind } },
                create: { repoFullName, prNumber, kind, commentId, headSha },
                update: { commentId, headSha },
            });
        },
        runExclusive(repoFullName, prNumber, fn) {
            return withAdvisoryLock(db, `github-pr-comment:${kind}:${repoFullName}:${prNumber}`, fn);
        },
    };
}
