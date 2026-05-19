import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffsClient } from "../../src/diffs/diffs-client.js";

describe("DiffsClient", () => {
    const API_URL = "http://api.test.svc.cluster.local:4000";
    const SERVICE_TOKEN = "test-service-token";
    const params = {
        organizationId: "org-123",
        repoId: 42,
        prNumber: 7,
        url: "https://web-pr-7-acme.preview.autonoma.app",
    };

    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("makes a POST to /v1/diffs/internal/trigger with correct headers and body", async () => {
        fetchMock.mockResolvedValueOnce({ ok: true } as Response);

        const client = new DiffsClient(API_URL, SERVICE_TOKEN);
        await client.triggerPrDiffs(params);

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

        expect(url).toBe(`${API_URL}/v1/diffs/internal/trigger`);
        expect(init.method).toBe("POST");
        expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${SERVICE_TOKEN}`);
        expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body).toEqual({
            organization_id: params.organizationId,
            repo_id: params.repoId,
            pr_number: params.prNumber,
            url: params.url,
        });
    });

    it("resolves without throwing on a 200 response", async () => {
        fetchMock.mockResolvedValueOnce({ ok: true } as Response);

        const client = new DiffsClient(API_URL, SERVICE_TOKEN);
        await expect(client.triggerPrDiffs(params)).resolves.toBeUndefined();
    });

    it("throws with the status code when the response is not ok", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: () => Promise.resolve("Unauthorized"),
        } as Response);

        const client = new DiffsClient(API_URL, SERVICE_TOKEN);
        await expect(client.triggerPrDiffs(params)).rejects.toThrow("401");
    });

    it("throws when the server returns a 500 error", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: () => Promise.resolve("Internal Server Error"),
        } as Response);

        const client = new DiffsClient(API_URL, SERVICE_TOKEN);
        await expect(client.triggerPrDiffs(params)).rejects.toThrow("500");
    });

    it("attaches an AbortSignal with a 10-second timeout", async () => {
        fetchMock.mockResolvedValueOnce({ ok: true } as Response);

        const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

        const client = new DiffsClient(API_URL, SERVICE_TOKEN);
        await client.triggerPrDiffs(params);

        expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    });
});
