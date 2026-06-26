import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BuildLogEntry } from "../../src/build-log-event";
import { LokiBuildLogSink } from "../../src/loki-build-log-sink";
import { LokiLogStore } from "../../src/loki-log-store";

/**
 * Exercises the full build-log producer -> consumer pair against a real Loki
 * (Testcontainers): events appended through LokiBuildLogSink must come back
 * out of LokiLogStore("build") in order with kind/app intact - the exact path
 * the previewkit worker (write) and the apps/api SSE relay (read) use when
 * PREVIEWKIT_BUILD_LOG_STORE=loki. Run with `pnpm test:integration`.
 */
describe("LokiBuildLogSink (integration)", () => {
    let container: StartedTestContainer;
    let baseUrl: string;
    let buildStore: LokiLogStore;

    beforeAll(async () => {
        container = await new GenericContainer("grafana/loki:3.4.1")
            .withExposedPorts(3100)
            .withWaitStrategy(Wait.forHttp("/ready", 3100).withStartupTimeout(120_000))
            .start();
        baseUrl = `http://${container.getHost()}:${container.getMappedPort(3100)}`;
        buildStore = new LokiLogStore(baseUrl, "build");
    }, 130_000);

    afterAll(async () => {
        await container?.stop();
    });

    /** Ingestion is near-instant but not synchronous; poll briefly to avoid flakes. */
    async function readUntil(namespace: string, minEntries: number): Promise<BuildLogEntry[]> {
        const deadline = Date.now() + 10_000;
        let batch = await buildStore.readBatch(namespace, "0");
        while (batch.length < minEntries && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            batch = await buildStore.readBatch(namespace, "0");
        }
        return batch;
    }

    it("round-trips a build's events through seal to a build-source store, in append order", async () => {
        const sink = new LokiBuildLogSink(baseUrl);
        const namespace = "preview-acme-api-pr-1";

        await sink.append(namespace, { kind: "phase", message: "building-images" });
        await sink.append(namespace, { kind: "log", app: "api", message: "step 1/3\n" });
        await sink.append(namespace, { kind: "log", app: "api", message: "step 2/3\n" });
        await sink.append(namespace, { kind: "status", message: "ready" });
        // seal flushes the buffer (Loki's retention period handles expiry).
        await sink.seal(namespace);

        const entries = await readUntil(namespace, 4);

        expect(entries.map((entry) => entry.event)).toEqual([
            { kind: "phase", message: "building-images" },
            { kind: "log", app: "api", message: "step 1/3\n" },
            { kind: "log", app: "api", message: "step 2/3\n" },
            { kind: "status", message: "ready" },
        ]);

        await sink.close();
    });

    it("close drains buffered lines without a seal", async () => {
        const sink = new LokiBuildLogSink(baseUrl);
        const namespace = "preview-acme-api-pr-2";

        await sink.append(namespace, { kind: "log", app: "web", message: "tail line\n" });
        await sink.close();

        const entries = await readUntil(namespace, 1);
        expect(entries.map((entry) => entry.event.message)).toEqual(["tail line\n"]);
    });

    it("markStart overwrites a prior attempt's lines for a fresh viewer", async () => {
        const sink = new LokiBuildLogSink(baseUrl);
        const namespace = "preview-acme-api-pr-4";

        // First attempt.
        await sink.markStart(namespace);
        await sink.append(namespace, { kind: "log", app: "api", message: "attempt 1 line\n" });
        await sink.seal(namespace);
        await readUntil(namespace, 1);

        // Second attempt - markStart resets the replay floor.
        await sink.markStart(namespace);
        await sink.append(namespace, { kind: "log", app: "api", message: "attempt 2 line\n" });
        await sink.seal(namespace);

        const deadline = Date.now() + 10_000;
        let entries = await buildStore.readBatch(namespace, "0");
        while ((entries.length !== 1 || entries[0]?.event.message !== "attempt 2 line\n") && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            entries = await buildStore.readBatch(namespace, "0");
        }
        expect(entries.map((entry) => entry.event.message)).toEqual(["attempt 2 line\n"]);

        await sink.close();
    });

    it("markDeploymentStart scopes a fresh app-log viewer to the latest deployment", async () => {
        const sink = new LokiBuildLogSink(baseUrl);
        const appStore = new LokiLogStore(baseUrl, "app");
        const namespace = "preview-acme-api-pr-5";

        // Runtime app lines are scraped from pods (here pushed directly, the way
        // the Alloy DaemonSet does); the sink only writes the deployment marker.
        const pushAppLine = async (tsNs: string, message: string): Promise<void> => {
            const response = await fetch(`${baseUrl}/loki/api/v1/push`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    streams: [
                        {
                            stream: { namespace, source: "app", app: "api", stream: "stdout", kind: "log" },
                            values: [[tsNs, message]],
                        },
                    ],
                }),
            });
            if (!response.ok) throw new Error(`app push failed: ${response.status} ${await response.text()}`);
        };

        // A line from the prior deployment (an hour ago), then this deployment's
        // marker, then a line from the new deployment - the new line's timestamp
        // is taken after markDeploymentStart, so it never precedes the marker.
        await pushAppLine(((BigInt(Date.now()) - 3_600_000n) * 1_000_000n).toString(), "old deployment line\n");
        await sink.markDeploymentStart(namespace);
        await pushAppLine((BigInt(Date.now()) * 1_000_000n).toString(), "new deployment line\n");

        // The marker resets the replay floor, so a fresh viewer sees only the new
        // deployment's line - the prior deployment's output is superseded.
        const deadline = Date.now() + 10_000;
        let entries = await appStore.readBatch(namespace, "0");
        while (
            (entries.length !== 1 || entries[0]?.event.message !== "new deployment line\n") &&
            Date.now() < deadline
        ) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            entries = await appStore.readBatch(namespace, "0");
        }
        expect(entries.map((entry) => entry.event.message)).toEqual(["new deployment line\n"]);

        await sink.close();
    });

    it("never throws when Loki is unreachable - the build must survive a sink outage", async () => {
        const sink = new LokiBuildLogSink("http://127.0.0.1:9");
        const namespace = "preview-acme-api-pr-3";

        await expect(sink.append(namespace, { kind: "log", message: "x\n" })).resolves.toBeUndefined();
        await expect(sink.markStart(namespace)).resolves.toBeUndefined();
        await expect(sink.markDeploymentStart(namespace)).resolves.toBeUndefined();
        await expect(sink.seal(namespace)).resolves.toBeUndefined();
        await expect(sink.close()).resolves.toBeUndefined();
    });
});
