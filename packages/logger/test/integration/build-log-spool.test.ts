import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BuildLogSpool } from "../../src/build-log-spool";

/**
 * Exercises the BuildLogSpool against a real Redis (Testcontainers) - the
 * append -> readBatch round-trip, cursor resume, namespace isolation, and seal
 * TTL behaviour that types alone can't prove. Mirrors the API's container setup
 * (redis:7-alpine, getConnectionUrl). Run with `pnpm test:integration`; the
 * default `pnpm test` excludes `test/integration/**`, so it needs no Docker.
 */
describe("BuildLogSpool (integration)", () => {
    let container: StartedRedisContainer;
    let redis: Redis;
    let spool: BuildLogSpool;

    beforeAll(async () => {
        container = await new RedisContainer("redis:7-alpine").withStartupTimeout(120_000).start();
        redis = new Redis(container.getConnectionUrl());
        spool = new BuildLogSpool(redis);
    }, 130_000);

    afterAll(async () => {
        await redis?.quit();
        await container?.stop();
    });

    it("round-trips log/phase/status events in append order from the start cursor", async () => {
        const namespace = "preview-acme-api-pr-1";

        await spool.append(namespace, { kind: "phase", message: "building-images" });
        await spool.append(namespace, { kind: "log", app: "api", message: "step 1/3\n" });
        await spool.append(namespace, { kind: "log", app: "api", message: "step 2/3\n" });
        await spool.append(namespace, { kind: "status", message: "ready" });

        const entries = await spool.readBatch(namespace, "0");

        expect(entries.map((entry) => entry.event)).toEqual([
            { kind: "phase", message: "building-images" },
            { kind: "log", app: "api", message: "step 1/3\n" },
            { kind: "log", app: "api", message: "step 2/3\n" },
            { kind: "status", message: "ready" },
        ]);
    });

    it("resumes after a cursor, returning only entries newer than it", async () => {
        const namespace = "preview-acme-api-pr-2";

        await spool.append(namespace, { kind: "log", app: "web", message: "first\n" });
        const firstBatch = await spool.readBatch(namespace, "0");
        expect(firstBatch).toHaveLength(1);

        const firstEntry = firstBatch[0];
        if (firstEntry == null) throw new Error("expected the first entry to be present");

        // Reading again from that cursor yields nothing until more is appended.
        expect(await spool.readBatch(namespace, firstEntry.id)).toEqual([]);

        await spool.append(namespace, { kind: "log", app: "web", message: "second\n" });
        const resumed = await spool.readBatch(namespace, firstEntry.id);

        expect(resumed.map((entry) => entry.event.message)).toEqual(["second\n"]);
    });

    it("isolates streams by namespace", async () => {
        await spool.append("preview-a-pr-1", { kind: "log", message: "from a\n" });
        await spool.append("preview-b-pr-1", { kind: "log", message: "from b\n" });

        const fromA = await spool.readBatch("preview-a-pr-1", "0");

        expect(fromA.map((entry) => entry.event.message)).toEqual(["from a\n"]);
    });

    it("returns an empty batch for a stream that was never written", async () => {
        expect(await spool.readBatch("preview-never-written-pr-9", "0")).toEqual([]);
    });

    it("seal shortens the stream TTL from the active safety-net to the post-build window", async () => {
        const namespace = "preview-acme-api-pr-3";
        // Mirrors BuildLogSpool's key scheme (`previewkit:logs:<namespace>`).
        const key = `previewkit:logs:${namespace}`;

        await spool.append(namespace, { kind: "log", message: "x\n" });

        // append refreshes a long safety-net TTL so an unsealed (crashed) build
        // still gets reclaimed.
        const activeTtl = await redis.ttl(key);
        expect(activeTtl).toBeGreaterThan(60);

        await spool.seal(namespace, 30);

        const sealedTtl = await redis.ttl(key);
        expect(sealedTtl).toBeGreaterThan(0);
        expect(sealedTtl).toBeLessThanOrEqual(30);
    });
});
