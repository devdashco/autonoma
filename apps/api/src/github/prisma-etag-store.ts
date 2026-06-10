import type { PrismaClient } from "@autonoma/db";
import type { EtagStore } from "@autonoma/github";
import { type Logger, logger } from "@autonoma/logger";

/**
 * Postgres-backed {@link EtagStore}. Persists GitHub ETags in the `github_request_etag`
 * table, keyed by (installationId, requestKey), so conditional requests survive pod
 * restarts. We store only the ETag string - on a 304 the caller keeps its existing cache.
 */
export class PrismaEtagStore implements EtagStore {
    private readonly logger: Logger;

    constructor(private readonly db: PrismaClient) {
        this.logger = logger.child({ name: this.constructor.name });
    }

    async get(installationId: number, requestKey: string): Promise<string | undefined> {
        const row = await this.db.gitHubRequestEtag.findUnique({
            where: { installationId_requestKey: { installationId, requestKey } },
            select: { etag: true },
        });
        this.logger.debug("Read ETag", { extra: { installationId, requestKey, hit: row != null } });
        return row?.etag ?? undefined;
    }

    async set(installationId: number, requestKey: string, etag: string): Promise<void> {
        await this.db.gitHubRequestEtag.upsert({
            where: { installationId_requestKey: { installationId, requestKey } },
            create: { installationId, requestKey, etag },
            update: { etag },
        });
        this.logger.debug("Stored ETag", { extra: { installationId, requestKey } });
    }
}
