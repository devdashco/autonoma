import type { Redis } from "ioredis";
import { z } from "zod";
import { rootLogger } from "./logger-backend";

/**
 * Live build-log streaming tier.
 *
 * This is the buffer that sits BETWEEN the previewkit build process (the
 * producer, soon a Temporal activity) and the autonoma API (the consumer that
 * relays to the browser over SSE). The producer `append`s log lines + phase
 * transitions to a per-environment Redis Stream; the consumer polls `readBatch`
 * and forwards. When the build finishes the producer `seal`s the stream (short
 * TTL) and the permanent copy lives in S3 - this tier is purely ephemeral.
 *
 * IMPORTANT: this is NOT a logger. It is intentionally separate from the
 * Sentry/console telemetry pipe in this same package - build output is
 * customer-facing data (and may echo secrets), so it must never flow into
 * Sentry. Keep the two planes distinct: `rootLogger` observes THIS class; the
 * class itself is the data plane.
 *
 * A Redis Stream (rather than pub/sub) is used so a late-joining or reconnecting
 * viewer can replay from a cursor: stream entry ids map directly onto the SSE
 * `Last-Event-ID` resume protocol, and `MAXLEN ~` bounds memory.
 */

const KEY_PREFIX = "previewkit:logs";
const DEFAULT_MAX_LEN = 5000;
// Safety-net TTL refreshed on every append, so a build that crashes without
// sealing still has its stream reclaimed. `seal` shortens this post-build.
const DEFAULT_ACTIVE_TTL_SECONDS = 6 * 60 * 60;
// How many entries a single readBatch pulls per poll.
const READ_COUNT = 500;

export const BuildLogEventSchema = z.object({
    kind: z.enum(["log", "phase", "status"]),
    /** The app this line belongs to (build output is per-app); absent for phase/status. */
    app: z.string().optional(),
    message: z.string(),
});

export type BuildLogEvent = z.infer<typeof BuildLogEventSchema>;

export interface BuildLogEntry {
    /** Redis Stream entry id, e.g. "1718000000000-0". Doubles as the SSE event id. */
    id: string;
    event: BuildLogEvent;
}

export class BuildLogSpool {
    private readonly logger = rootLogger.child({ name: "BuildLogSpool" });
    private readonly maxLen: number;
    private readonly activeTtlSeconds: number;

    constructor(
        private readonly redis: Redis,
        options: { maxLen?: number; activeTtlSeconds?: number } = {},
    ) {
        this.maxLen = options.maxLen ?? DEFAULT_MAX_LEN;
        this.activeTtlSeconds = options.activeTtlSeconds ?? DEFAULT_ACTIVE_TTL_SECONDS;
    }

    private key(environmentId: string): string {
        return `${KEY_PREFIX}:${environmentId}`;
    }

    // ─── Producer (previewkit build pipeline) ─────────────────────────────

    /**
     * Append one event to an environment's stream. Best-effort: a Redis failure
     * is logged and swallowed so it can never break the build it is observing.
     */
    async append(environmentId: string, event: BuildLogEvent): Promise<void> {
        const key = this.key(environmentId);
        try {
            await this.redis
                .pipeline()
                .xadd(
                    key,
                    "MAXLEN",
                    "~",
                    this.maxLen,
                    "*",
                    "kind",
                    event.kind,
                    "app",
                    event.app ?? "",
                    "message",
                    event.message,
                )
                .expire(key, this.activeTtlSeconds)
                .exec();
        } catch (err) {
            this.logger.warn("Failed to append build log event", { environmentId, kind: event.kind, err });
        }
    }

    /**
     * Mark a stream finished by shortening its TTL. Existing viewers keep
     * reading until it expires; new viewers should prefer the S3 archive once a
     * sealed stream is gone.
     */
    async seal(environmentId: string, ttlSeconds: number): Promise<void> {
        try {
            await this.redis.expire(this.key(environmentId), ttlSeconds);
        } catch (err) {
            this.logger.warn("Failed to seal build log stream", { environmentId, ttlSeconds, err });
        }
    }

    // ─── Consumer (autonoma API SSE relay) ────────────────────────────────

    /**
     * Read entries newer than `afterId` ("0" reads from the start, replaying
     * history). Non-blocking - callers poll and sleep between batches, which
     * keeps a single shared Redis connection serving many concurrent viewers.
     */
    async readBatch(environmentId: string, afterId: string): Promise<BuildLogEntry[]> {
        const result = await this.redis.xread("COUNT", READ_COUNT, "STREAMS", this.key(environmentId), afterId);
        if (result == null) return [];

        const entries: BuildLogEntry[] = [];
        for (const stream of result) {
            const streamEntries = stream[1];
            for (const item of streamEntries) {
                const event = parseFields(item[1]);
                if (event != null) entries.push({ id: item[0], event });
            }
        }
        return entries;
    }
}

/** Rebuild a BuildLogEvent from Redis Stream flat field pairs; drops malformed entries. */
function parseFields(fields: string[]): BuildLogEvent | undefined {
    const record: Record<string, string> = {};
    for (let i = 0; i + 1 < fields.length; i += 2) {
        const fieldKey = fields[i];
        const fieldValue = fields[i + 1];
        if (fieldKey != null && fieldValue != null) record[fieldKey] = fieldValue;
    }

    const app = record["app"];
    const result = BuildLogEventSchema.safeParse({
        kind: record["kind"],
        app: app == null || app === "" ? undefined : app,
        message: record["message"] ?? "",
    });
    return result.success ? result.data : undefined;
}
