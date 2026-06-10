import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProvisionInput } from "../src/addons/provider";
import { NeonProvider } from "../src/addons/providers/neon";

function jsonResponse(body: unknown) {
    return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

const input: ProvisionInput = {
    options: { project_id: "proj1" },
    authSecret: { token: "tok" },
    prNumber: 7,
    namespace: "preview-acme-web-pr-7",
    organizationId: "org_1",
};

describe("NeonProvider find-or-create idempotency", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("creates a branch on first provision and reuses it on re-provision (no second create)", async () => {
        const calls: Array<{ method: string; path: string }> = [];
        let branchExists = false;

        const fetchMock = vi.fn(async (url: string | URL, init?: { method?: string }) => {
            const parsed = new URL(String(url));
            const method = init?.method ?? "GET";
            calls.push({ method, path: parsed.pathname });

            if (method === "GET" && parsed.pathname.endsWith("/branches")) {
                return jsonResponse({ branches: branchExists ? [{ id: "br1", name: "previewkit-pr-7" }] : [] });
            }
            if (method === "POST" && parsed.pathname.endsWith("/branches")) {
                branchExists = true;
                return jsonResponse({ branch: { id: "br1" }, endpoints: [{ id: "ep1", host: "host1" }] });
            }
            if (method === "GET" && parsed.pathname.endsWith("/branches/br1/endpoints")) {
                return jsonResponse({ endpoints: [{ id: "ep1", host: "host1", type: "read_write" }] });
            }
            if (method === "GET" && parsed.pathname.endsWith("/connection_uri")) {
                return jsonResponse({ uri: "postgres://u:p@host1/neondb" });
            }
            throw new Error(`unexpected request ${method} ${parsed.pathname}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const provider = new NeonProvider("https://neon.test/api/v2");

        const first = await provider.provision(input);
        expect(first.outputs.host).toBe("host1");
        expect(first.outputs.connectionString).toContain("postgres://");

        const second = await provider.provision(input);
        expect(second.outputs.host).toBe("host1");

        const branchCreates = calls.filter((c) => c.method === "POST" && c.path.endsWith("/branches"));
        expect(branchCreates).toHaveLength(1);
    });
});
