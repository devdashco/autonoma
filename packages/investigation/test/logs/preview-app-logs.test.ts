import { logger as rootLogger } from "@autonoma/logger";
import { describe, expect, it, vi } from "vitest";
import { loadPreviewAppLogs } from "../../src/logs/preview-app-logs";

const logger = rootLogger.child({ name: "preview-app-logs-test" });
const base = { regex: "error", startEpoch: 1000, endEpoch: 2000, logger };

describe("loadPreviewAppLogs", () => {
    it("returns an unavailable note WITHOUT querying when no Loki endpoint is configured", async () => {
        const queryLogs = vi.fn();
        const out = await loadPreviewAppLogs({ ...base, lokiUrl: undefined, namespace: "preview-ns" }, queryLogs);

        expect(out).toMatch(/no Loki endpoint configured/i);
        expect(queryLogs).not.toHaveBeenCalled();
    });

    it("returns an unavailable note WITHOUT querying when the preview namespace could not be resolved", async () => {
        const queryLogs = vi.fn();
        const out = await loadPreviewAppLogs({ ...base, lokiUrl: "http://loki:3100", namespace: undefined }, queryLogs);

        expect(out).toMatch(/could not resolve this PR's preview namespace/i);
        expect(queryLogs).not.toHaveBeenCalled();
    });

    it("states an EMPTY result as fact so the classifier cannot invent a backend error", async () => {
        const out = await loadPreviewAppLogs(
            { ...base, lokiUrl: "http://loki:3100", namespace: "preview-ns" },
            async () => [],
        );

        expect(out).toMatch(/emitted no matching error/i);
        expect(out).toMatch(/do NOT infer a backend error/i);
    });

    it("queries the resolved namespace over the run window and returns the matched lines", async () => {
        // The fake echoes the query inputs into its output so we assert on observable behaviour, not a mock call.
        const queryLogs = vi.fn(
            async (q: { namespace: string; startEpoch: number; endEpoch: number; regex: string }) => [
                `ns=${q.namespace}`,
                `window=${q.startEpoch}-${q.endEpoch}`,
                `regex=${q.regex}`,
                "the app threw NullPointer",
            ],
        );

        const out = await loadPreviewAppLogs(
            { ...base, lokiUrl: "http://loki:3100", namespace: "preview-ns" },
            queryLogs,
        );

        expect(out).toContain("ns=preview-ns");
        expect(out).toContain("window=1000-2000");
        expect(out).toContain("regex=error");
        expect(out).toContain("the app threw NullPointer");
    });

    it("degrades to a clear NON-throwing note when the Loki query fails", async () => {
        const out = await loadPreviewAppLogs(
            { ...base, lokiUrl: "http://loki:3100", namespace: "preview-ns" },
            async () => {
                throw new Error("Loki returned HTTP 503 for namespace preview-ns");
            },
        );

        expect(out).toMatch(/Could not query app logs/i);
        expect(out).toMatch(/HTTP 503/);
    });
});
