import { logger as rootLogger } from "../logger";

export interface TriggerDiffsParams {
    organizationId: string;
    repoId: number;
    prNumber: number;
    url: string;
}

export class DiffsClient {
    private readonly logger;

    constructor(
        private readonly apiUrl: string,
        private readonly serviceSecret: string,
    ) {
        this.logger = rootLogger.child({ name: this.constructor.name });
    }

    async triggerPrDiffs(params: TriggerDiffsParams): Promise<void> {
        const endpoint = `${this.apiUrl}/v1/diffs/internal/trigger`;
        this.logger.info("Triggering diffs via Autonoma API", {
            endpoint,
            prNumber: params.prNumber,
            repoId: params.repoId,
        });

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.serviceSecret}`,
            },
            body: JSON.stringify({
                organization_id: params.organizationId,
                repo_id: params.repoId,
                pr_number: params.prNumber,
                url: params.url,
            }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "(no body)");
            throw new Error(`Diffs trigger failed with status ${response.status}: ${text}`);
        }

        this.logger.info("Diffs triggered successfully", { prNumber: params.prNumber });
    }
}
