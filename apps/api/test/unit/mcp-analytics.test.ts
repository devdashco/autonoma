import { PostHogAnalytics } from "@autonoma/analytics";
import { describe, expect, it } from "vitest";
import { McpAnalytics } from "../../src/mcp/mcp-analytics";

interface CapturedEvent {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
    groups?: Record<string, string>;
}

/** Records every `capture(...)` instead of shipping it, so we can assert the emitted event. */
class RecordingAnalytics extends PostHogAnalytics {
    public captures: CapturedEvent[] = [];

    override capture(
        distinctId: string,
        event: string,
        properties?: Record<string, unknown>,
        groups?: Record<string, string>,
    ): void {
        this.captures.push({ distinctId, event, properties, groups });
    }
}

const okResult = { content: [{ type: "text" as const, text: "ok" }] };
const errorResult = { content: [{ type: "text" as const, text: "boom" }], isError: true };

describe("McpAnalytics", () => {
    it("emits mcp.tool_called attributed to the org a tool resolves, as both a property and a group", async () => {
        const analytics = new RecordingAnalytics();
        const mcp = new McpAnalytics(analytics, "debug", "user-1");
        const resolveOrg = mcp.observeOrgResolution(async () => "org-42");

        // No surrounding observability scope on purpose: track must open its own,
        // which is the production path (the transport dispatches the handler with
        // no scope bound). If org were only readable from an outer frame, this fails.
        await mcp.track("get_deploy_status", async () => {
            await resolveOrg("acme/app");
            return okResult;
        });

        expect(analytics.captures).toHaveLength(1);
        const [captured] = analytics.captures;
        expect(captured?.distinctId).toBe("user-1");
        expect(captured?.event).toBe("mcp.tool_called");
        expect(captured?.properties).toMatchObject({
            server: "debug",
            tool: "get_deploy_status",
            success: true,
            organizationId: "org-42",
        });
        expect(captured?.properties?.durationMs).toBeTypeOf("number");
        expect(captured?.groups).toEqual({ organization: "org-42" });
    });

    it("isolates org attribution per call: a later tool that resolves no org is not tagged with an earlier one", async () => {
        const analytics = new RecordingAnalytics();
        const mcp = new McpAnalytics(analytics, "debug", "user-1");
        const resolveOrg = mcp.observeOrgResolution(async () => "org-42");

        await mcp.track("get_deploy_status", async () => {
            await resolveOrg("acme/app");
            return okResult;
        });
        await mcp.track("list_apps", async () => okResult);

        expect(analytics.captures[0]?.properties?.organizationId).toBe("org-42");
        expect(analytics.captures[1]?.properties?.organizationId).toBeUndefined();
        expect(analytics.captures[1]?.groups).toBeUndefined();
    });

    it("records success:false when a handler returns an error result", async () => {
        const analytics = new RecordingAnalytics();
        const mcp = new McpAnalytics(analytics, "debug", "user-1");

        await mcp.track("set_secret", async () => errorResult);

        expect(analytics.captures[0]?.properties?.success).toBe(false);
    });

    it("records success:false and rethrows when a handler throws", async () => {
        const analytics = new RecordingAnalytics();
        const mcp = new McpAnalytics(analytics, "debug", "user-1");

        await expect(
            mcp.track("diagnose_deploy", async () => {
                throw new Error("kaboom");
            }),
        ).rejects.toThrow("kaboom");

        expect(analytics.captures[0]?.properties?.success).toBe(false);
    });

    it("omits org attribution for a tool that never resolves one (e.g. list_apps)", async () => {
        const analytics = new RecordingAnalytics();
        const mcp = new McpAnalytics(analytics, "debug", "user-1");

        await mcp.track("list_apps", async () => okResult);

        expect(analytics.captures[0]?.properties?.organizationId).toBeUndefined();
        expect(analytics.captures[0]?.groups).toBeUndefined();
    });
});
