import { type IncomingMessage, type Server, createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionScenarioInstance, teardownScenarioInstance } from "../src/scenario-provisioner";

const SIGNING_SECRET = "test-secret";

const MINIMAL_FIXTURE = {
    name: "checkout",
    description: "Checkout flow",
    create: {
        Organization: [{ _alias: "org1", name: "Acme Corp" }],
    },
    variables: {},
    validation: { status: "validated", method: "endpoint-up-down", phase: "ok" },
};

const FIXTURE_WITH_VARIABLES = {
    name: "checkout",
    description: "Checkout flow with variables",
    create: {
        User: [{ email: "{{owner_email}}", organizationId: "{{org_id}}" }],
    },
    variables: {
        owner_email: {
            strategy: "derived",
            source: "testRunId",
            format: "owner+{testRunId}@example.test",
        },
        org_id: { strategy: "literal", value: "org-static-123" },
    },
    validation: { status: "validated", method: "endpoint-up-down", phase: "ok" },
};

class TestServer {
    private readonly server: Server;
    private handler: (req: IncomingMessage, body: unknown) => { status: number; body: unknown } = () => ({
        status: 200,
        body: {},
    });
    public readonly requests: Array<{ method: string; body: unknown; headers: Record<string, string | undefined> }> =
        [];
    public port = 0;

    constructor() {
        this.server = createServer((req, res) => {
            this.readBody(req).then((body) => {
                this.requests.push({
                    method: req.method ?? "GET",
                    body,
                    headers: req.headers as Record<string, string | undefined>,
                });
                const result = this.handler(req, body);
                res.writeHead(result.status, { "Content-Type": "application/json" });
                res.end(JSON.stringify(result.body));
            });
        });
    }

    async start(): Promise<void> {
        return new Promise((resolve) => {
            this.server.listen(0, () => {
                const addr = this.server.address();
                if (addr != null && typeof addr === "object") {
                    this.port = addr.port;
                }
                resolve();
            });
        });
    }

    get url(): string {
        return `http://localhost:${this.port}/sdk`;
    }

    onRequest(handler: (req: IncomingMessage, body: unknown) => { status: number; body: unknown }): void {
        this.handler = handler;
    }

    reset(): void {
        this.requests.length = 0;
        this.handler = () => ({ status: 200, body: {} });
    }

    async stop(): Promise<void> {
        return new Promise((resolve) => {
            this.server.close(() => resolve());
        });
    }

    private readBody(req: IncomingMessage): Promise<unknown> {
        return new Promise((resolve) => {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            req.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf8");
                try {
                    resolve(JSON.parse(raw));
                } catch (err) {
                    console.warn("TestServer: could not parse request body as JSON, returning raw string", err);
                    resolve(raw);
                }
            });
        });
    }
}

describe("provisionScenarioInstance (DB-free)", () => {
    let server: TestServer;

    beforeAll(async () => {
        server = new TestServer();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    beforeEach(() => {
        server.reset();
    });

    it("resolves payload and calls SDK up, returning auth + refs", async () => {
        server.onRequest(() => ({
            status: 200,
            body: {
                auth: { headers: { Authorization: "Bearer tok-abc" } },
                refs: { userId: "u-1" },
                refsToken: "refs-tok-1",
                expiresInSeconds: 3600,
            },
        }));

        const result = await provisionScenarioInstance({
            fixtureJson: MINIMAL_FIXTURE,
            sdkUrl: server.url,
            signingSecret: SIGNING_SECRET,
        });

        expect(result.auth).toEqual({ headers: { Authorization: "Bearer tok-abc" } });
        expect(result.refs).toEqual({ userId: "u-1" });
        expect(result.refsToken).toBe("refs-tok-1");
        expect(typeof result.instanceId).toBe("string");
        expect(result.instanceId.length).toBeGreaterThan(0);
    });

    it("sends action=up with create payload and testRunId to the SDK endpoint", async () => {
        server.onRequest(() => ({ status: 200, body: { auth: undefined } }));

        await provisionScenarioInstance({
            fixtureJson: MINIMAL_FIXTURE,
            sdkUrl: server.url,
            signingSecret: SIGNING_SECRET,
        });

        const sentBody = server.requests[0]?.body as Record<string, unknown>;
        expect(sentBody.action).toBe("up");
        expect(sentBody.create).toEqual({ Organization: [{ _alias: "org1", name: "Acme Corp" }] });
        expect(typeof sentBody.testRunId).toBe("string");
    });

    it("uses the supplied testRunId and drives variable resolution from it", async () => {
        server.onRequest(() => ({ status: 200, body: {} }));

        const testRunId = "run-fixed-id-for-test";
        const result = await provisionScenarioInstance({
            fixtureJson: FIXTURE_WITH_VARIABLES,
            testRunId,
            sdkUrl: server.url,
            signingSecret: SIGNING_SECRET,
        });

        expect(result.instanceId).toBe(testRunId);
        expect(result.resolvedVariables["owner_email"]).toBe(`owner+${testRunId}@example.test`);
        expect(result.resolvedVariables["org_id"]).toBe("org-static-123");

        const sentBody = server.requests[0]?.body as Record<string, unknown>;
        expect(sentBody.testRunId).toBe(testRunId);
        const users = (sentBody.create as Record<string, unknown>).User as Array<Record<string, unknown>>;
        expect(users[0]?.email).toBe(`owner+${testRunId}@example.test`);
        expect(users[0]?.organizationId).toBe("org-static-123");
    });

    it("signs the request with HMAC-SHA256", async () => {
        server.onRequest(() => ({ status: 200, body: {} }));

        await provisionScenarioInstance({
            fixtureJson: MINIMAL_FIXTURE,
            sdkUrl: server.url,
            signingSecret: SIGNING_SECRET,
        });

        const sigHeader = server.requests[0]?.headers["x-signature"];
        expect(sigHeader).toMatch(/^[a-f0-9]+$/);
    });

    it("throws when the SDK endpoint returns an error status", async () => {
        server.onRequest(() => ({ status: 500, body: { error: "internal error" } }));

        await expect(
            provisionScenarioInstance({
                fixtureJson: MINIMAL_FIXTURE,
                sdkUrl: server.url,
                signingSecret: SIGNING_SECRET,
            }),
        ).rejects.toThrow("SDK returned HTTP 500");
    });

    it("returns empty resolvedVariables for a no-variable fixture", async () => {
        server.onRequest(() => ({ status: 200, body: {} }));

        const result = await provisionScenarioInstance({
            fixtureJson: MINIMAL_FIXTURE,
            sdkUrl: server.url,
            signingSecret: SIGNING_SECRET,
        });

        expect(result.resolvedVariables).toEqual({});
    });
});

describe("teardownScenarioInstance (DB-free)", () => {
    let server: TestServer;

    beforeAll(async () => {
        server = new TestServer();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    beforeEach(() => {
        server.reset();
    });

    it("calls SDK down with instanceId, refs, and refsToken", async () => {
        server.onRequest(() => ({ status: 200, body: { ok: true } }));

        await teardownScenarioInstance({
            instanceId: "inst-1",
            sdkUrl: server.url,
            signingSecret: SIGNING_SECRET,
            refs: { userId: "u-1" },
            refsToken: "refs-tok-1",
        });

        const sentBody = server.requests[0]?.body as Record<string, unknown>;
        expect(sentBody.action).toBe("down");
        expect(sentBody.testRunId).toBe("inst-1");
        expect(sentBody.refs).toEqual({ userId: "u-1" });
        expect(sentBody.refsToken).toBe("refs-tok-1");
    });

    it("calls down with null refs when none provided", async () => {
        server.onRequest(() => ({ status: 200, body: { ok: true } }));

        await teardownScenarioInstance({
            instanceId: "inst-2",
            sdkUrl: server.url,
            signingSecret: SIGNING_SECRET,
        });

        const sentBody = server.requests[0]?.body as Record<string, unknown>;
        expect(sentBody.refs).toBeNull();
    });

    it("throws when the SDK endpoint returns an error", async () => {
        server.onRequest(() => ({ status: 502, body: { error: "gateway error" } }));

        await expect(
            teardownScenarioInstance({
                instanceId: "inst-3",
                sdkUrl: server.url,
                signingSecret: SIGNING_SECRET,
                refs: null,
            }),
        ).rejects.toThrow("SDK returned HTTP 502");
    });
});
