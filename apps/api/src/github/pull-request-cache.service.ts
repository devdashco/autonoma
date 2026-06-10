import type { PrismaClient, PullRequestCacheState } from "@autonoma/db";
import { z } from "zod";
import { env } from "../env";
import { Service } from "../routes/service";
import type { GitHubInstallationService } from "./github-installation.service";

// Only the fields we cache, parsed defensively from the raw GitHub pull_request webhook.
const webhookPullRequestEventSchema = z.object({
    pull_request: z.object({
        number: z.number(),
        title: z.string(),
        state: z.string(),
        merged: z.boolean().optional(),
        user: z.object({ login: z.string().optional() }).nullish(),
        updated_at: z.string(),
    }),
    repository: z.object({
        id: z.number(),
    }),
});

type WebhookPullRequest = z.infer<typeof webhookPullRequestEventSchema>["pull_request"];

function mapWebhookState(pr: WebhookPullRequest): PullRequestCacheState {
    if (pr.merged === true) return "merged";
    return pr.state === "closed" ? "closed" : "open";
}

/**
 * Owns the Postgres cache of GitHub PR metadata on FeatureBranchInfo. Two entry points:
 *
 *  - `updateFromWebhook` - the freshness mechanism. Called from the GitHub webhook handler
 *    on pull_request events; writes the latest PR metadata for tracked PRs.
 *  - `kickOff` / `revalidate` - a polite, fire-and-forget backstop kicked off when the PR
 *    list is read. Throttled entirely via Postgres (`min(prCachedAt)`), so it is correct
 *    across pods and pod restarts with no in-memory state. Bulk-lists open PRs (one
 *    ETag-conditional request) and backfills a bounded number of stale/uncached rows.
 *
 * Reusable: depends only on a PrismaClient and the GitHubInstallationService, so the
 * webhook router, BranchesService, and any future caller share one implementation.
 */
export class PullRequestCacheService extends Service {
    constructor(
        private readonly db: PrismaClient,
        private readonly github: GitHubInstallationService,
    ) {
        super();
    }

    async updateFromWebhook(organizationId: string, payload: Record<string, unknown>): Promise<void> {
        const parsed = webhookPullRequestEventSchema.safeParse(payload);
        if (!parsed.success) {
            this.logger.warn("PR cache: webhook payload missing pull_request or repository", {
                extra: { issues: parsed.error.issues },
            });
            return;
        }
        const { pull_request: pr, repository: repo } = parsed.data;

        this.logger.info("Updating PR cache from webhook", { organizationId, extra: { prNumber: pr.number } });

        const app = await this.db.application.findFirst({
            where: { organizationId, githubRepositoryId: repo.id },
            select: { id: true },
        });
        if (app == null) {
            this.logger.info("PR cache: no application linked to repo, skipping", {
                extra: { repoId: repo.id },
            });
            return;
        }

        // The PR list only shows tracked PRs (those with a FeatureBranchInfo row). We cannot
        // synthesize a Branch/branchId from a webhook, so we skip PRs Autonoma is not tracking.
        const existing = await this.db.featureBranchInfo.findUnique({
            where: { applicationId_prNumber: { applicationId: app.id, prNumber: pr.number } },
            select: { branchId: true },
        });
        if (existing == null) {
            this.logger.info("PR cache: no tracked branch for PR yet, skipping", {
                applicationId: app.id,
                extra: { prNumber: pr.number },
            });
            return;
        }

        await this.db.featureBranchInfo.update({
            where: { applicationId_prNumber: { applicationId: app.id, prNumber: pr.number } },
            data: {
                prTitle: pr.title,
                prState: mapWebhookState(pr),
                prAuthorLogin: pr.user?.login ?? null,
                prUpdatedAt: new Date(pr.updated_at),
                prCachedAt: new Date(),
            },
        });

        this.logger.info("PR cache updated from webhook", { applicationId: app.id, extra: { prNumber: pr.number } });
    }

    /** Fire-and-forget revalidation. Never blocks the caller; logs and swallows failures. */
    kickOff(applicationId: string, organizationId: string): void {
        void this.revalidate(applicationId, organizationId).catch((err) => {
            this.logger.warn("PR cache revalidation failed", {
                applicationId,
                extra: { error: err instanceof Error ? err.message : String(err) },
            });
        });
    }

    async revalidate(applicationId: string, organizationId: string): Promise<void> {
        const tracked = await this.db.featureBranchInfo.findMany({
            where: { applicationId },
            select: { prNumber: true, prCachedAt: true },
        });
        if (tracked.length === 0) return;

        const windowMs = env.GITHUB_PR_CACHE_REVALIDATE_WINDOW_MINUTES * 60_000;
        const staleBefore = Date.now() - windowMs;
        const hasUncached = tracked.some((t) => t.prCachedAt == null);
        const oldestCachedAt = tracked.reduce<Date | undefined>((min, t) => {
            if (t.prCachedAt == null) return min;
            return min == null || t.prCachedAt < min ? t.prCachedAt : min;
        }, undefined);

        const isFresh = !hasUncached && oldestCachedAt != null && oldestCachedAt.getTime() > staleBefore;
        if (isFresh) {
            this.logger.debug("PR cache fresh, skipping revalidation", { applicationId });
            return;
        }

        this.logger.info("Revalidating PR cache", { applicationId });

        const now = new Date();
        const result = await this.github.listApplicationPullRequests(organizationId, applicationId);

        if (result.unchanged) {
            // The open-PR list is byte-identical to the last fetch, so every already-cached
            // row is still current. Bump their prCachedAt to reset the freshness gate;
            // uncached rows fall through to the bounded backfill below.
            await this.db.featureBranchInfo.updateMany({
                where: { applicationId, prCachedAt: { not: null } },
                data: { prCachedAt: now },
            });
        } else {
            const trackedNumbers = new Set(tracked.map((t) => t.prNumber));
            const updates = result.pullRequests
                .filter((pr) => trackedNumbers.has(pr.number))
                .map((pr) =>
                    this.db.featureBranchInfo.update({
                        where: { applicationId_prNumber: { applicationId, prNumber: pr.number } },
                        data: {
                            prTitle: pr.title,
                            prState: pr.state,
                            prAuthorLogin: pr.authorLogin ?? null,
                            prUpdatedAt: new Date(pr.updatedAt),
                            prCachedAt: now,
                        },
                    }),
                );
            if (updates.length > 0) await this.db.$transaction(updates);
        }

        await this.backfillStale(applicationId, organizationId, staleBefore);
    }

    /**
     * Fills a bounded number of rows the open-PR list did not cover - closed/merged PRs,
     * PRs tracked before this feature, or rows missed by webhooks. Fetches them all in one
     * batch (repo/client resolved once, requests run concurrently and paced by the Octokit
     * throttling plugin), then writes them in a single transaction rather than one
     * round-trip per PR. Capped by GITHUB_PR_CACHE_BACKFILL_LIMIT so it stays polite and
     * converges over a few reads.
     */
    private async backfillStale(applicationId: string, organizationId: string, staleBefore: number): Promise<void> {
        const stale = await this.db.featureBranchInfo.findMany({
            where: {
                applicationId,
                OR: [{ prCachedAt: null }, { prCachedAt: { lt: new Date(staleBefore) } }],
            },
            select: { prNumber: true },
            orderBy: { prCachedAt: { sort: "asc", nulls: "first" } },
            take: env.GITHUB_PR_CACHE_BACKFILL_LIMIT,
        });
        if (stale.length === 0) return;

        this.logger.info("Backfilling stale PR cache rows", { applicationId, extra: { count: stale.length } });

        const prByNumber = await this.github.getApplicationPullRequests(
            organizationId,
            applicationId,
            stale.map((s) => s.prNumber),
        );
        if (prByNumber.size === 0) return;

        const now = new Date();
        const updates = [...prByNumber].map(([prNumber, pr]) =>
            this.db.featureBranchInfo.update({
                where: { applicationId_prNumber: { applicationId, prNumber } },
                data: {
                    prTitle: pr.title,
                    prState: pr.state,
                    prAuthorLogin: pr.authorLogin ?? null,
                    prUpdatedAt: new Date(pr.updatedAt),
                    prCachedAt: now,
                },
            }),
        );
        await this.db.$transaction(updates);
    }
}
