import { type AuthCaller, type CallerAuthVariables, requireApiKeyOrService } from "@autonoma/auth";
import { db } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import { type Context, Hono } from "hono";
import { env } from "../env";
import { openApiSpec } from "./openapi-spec";
import previewSchema from "./preview-schema.json" with { type: "json" };
import { PreviewkitEnvironmentsService } from "./previewkit-environments.service";
import { PreviewkitSecretsService, type SecretItem } from "./previewkit-secrets.service";
import { previewkitClient } from "./previewkit-service";

const logger = rootLogger.child({ name: "previewkitHttpRouter" });

// Native services - these run in the API process (DB + AWS Secrets Manager only,
// no Kubernetes), so they need no forwarding.
const secretsService = new PreviewkitSecretsService(env.S3_REGION);
const environmentsService = new PreviewkitEnvironmentsService(db);

// Auth for the native routes. Previewkit is the auth authority for the forwarded
// (heavy) routes, but the native routes terminate here, so the API must
// authenticate them itself - same middleware Previewkit used, applying per-caller
// org-scoping (API-key callers -> their org; the service secret -> no narrowing).
const requireAuth = requireApiKeyOrService({ db, serviceSecret: env.PREVIEWKIT_SERVICE_SECRET });

/**
 * Public HTTP surface for Previewkit, mounted at `/v1/previewkit`. Two kinds of route:
 *
 *  - **Native** (secrets CRUD, environment status, the `.preview.yaml` JSON schema, and the
 *    `openapi.json` describing this surface): implemented directly here - no forwarding. They
 *    need only the DB + AWS Secrets Manager, which the API already has.
 *
 *  - **Forwarded** (deploy / main-branch deploy / teardown / redeploy): transparently proxied
 *    to Previewkit via `PreviewkitClient`. These run Previewkit's full Kubernetes + BuildKit
 *    pipeline, which cannot execute inside the stateless API. The caller's `Authorization`
 *    header is passed through so Previewkit keeps applying its own auth + org-scoping; the
 *    deploy responses' `statusUrl` is rewritten to this `/v1/previewkit` mount. (These move to
 *    a Temporal worker in a later change.)
 */
export const previewkitHttpRouter = new Hono<{ Variables: CallerAuthVariables }>()
    // ─── Native: environment status (DB-backed) ───────────────────────
    .get("/environments/:owner/:repo/:pr", requireAuth, async (c) => {
        const pr = parseEnvironmentNumber(c.req.param("pr"));
        if (pr == null) return c.json({ error: "pr must be a non-negative integer" }, 400);

        const repoFullName = `${c.req.param("owner")}/${c.req.param("repo")}`;
        const status = await environmentsService.getStatus(repoFullName, pr, callerOrgId(c.var.authCaller));
        if (status == null) return c.json({ error: "Environment not found" }, 404);
        return c.json(status);
    })

    // ─── Native: per-app secrets CRUD ─────────────────────────────────
    .get("/secrets/:applicationId/:app", requireAuth, async (c) => {
        const applicationId = c.req.param("applicationId");
        const app = c.req.param("app");
        const keys = await secretsService.list(applicationId, app, callerOrgId(c.var.authCaller));
        return c.json({ applicationId, app, keys });
    })
    .put("/secrets/:applicationId/:app", requireAuth, async (c) => {
        const applicationId = c.req.param("applicationId");
        const app = c.req.param("app");

        let body: { items?: unknown };
        try {
            body = await c.req.json<{ items?: unknown }>();
        } catch {
            return c.json({ error: "Body must be JSON" }, 400);
        }

        const validation = validateItems(body.items);
        if (!validation.ok) return c.json({ error: validation.error }, 400);

        try {
            await secretsService.upsert(applicationId, app, validation.items, callerOrgId(c.var.authCaller));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes("Application not found")) return c.json({ error: message }, 404);
            throw err;
        }

        return c.json({ applicationId, app, status: "saved", count: validation.items.length });
    })
    .put("/secrets/:applicationId/:app/:key", requireAuth, async (c) => {
        const applicationId = c.req.param("applicationId");
        const app = c.req.param("app");
        const key = c.req.param("key");

        let body: { value?: unknown };
        try {
            body = await c.req.json<{ value?: unknown }>();
        } catch {
            return c.json({ error: "Body must be JSON" }, 400);
        }

        if (typeof body.value !== "string" || body.value.length === 0) {
            return c.json({ error: "Request body must include a non-empty string 'value'" }, 400);
        }

        try {
            await secretsService.upsert(
                applicationId,
                app,
                [{ key, value: body.value }],
                callerOrgId(c.var.authCaller),
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes("Application not found")) return c.json({ error: message }, 404);
            throw err;
        }

        return c.json({ applicationId, app, key, status: "saved" });
    })
    .delete("/secrets/:applicationId/:app/:key", requireAuth, async (c) => {
        const applicationId = c.req.param("applicationId");
        const app = c.req.param("app");
        const key = c.req.param("key");

        const deleted = await secretsService.delete(applicationId, app, key, callerOrgId(c.var.authCaller));
        if (!deleted) return c.json({ error: `Secret '${key}' not found` }, 404);

        return c.json({ applicationId, app, key, status: "deleted" });
    })

    // ─── Native: static `.preview.yaml` JSON schema (public, for editors) ──
    .get("/schema/preview.yaml.json", (c) => c.json(previewSchema))

    // ─── Forwarded: heavy pipeline ops + the OpenAPI spec ─────────────
    .post("/environments", (c) => proxyToPreviewkit(c, "environments", rewriteDeployStatusUrl))
    .post("/applications/:applicationId/0", (c) =>
        proxyToPreviewkit(c, `applications/${c.req.param("applicationId")}/0`, rewriteDeployStatusUrl),
    )
    .delete("/environments/:owner/:repo/:pr", (c) => proxyToPreviewkit(c, environmentSubPath(c)))
    .post("/environments/:owner/:repo/:pr/redeploy", (c) => proxyToPreviewkit(c, `${environmentSubPath(c)}/redeploy`))
    .get("/openapi.json", (c) => c.json(openApiSpec));

function callerOrgId(caller: AuthCaller): string | undefined {
    return caller.kind === "user" ? caller.organizationId : undefined;
}

function parseEnvironmentNumber(raw: string): number | undefined {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) return undefined;
    return value;
}

function environmentSubPath(c: Context): string {
    return `environments/${c.req.param("owner")}/${c.req.param("repo")}/${c.req.param("pr")}`;
}

interface ValidatedItems {
    ok: true;
    items: SecretItem[];
}
interface InvalidItems {
    ok: false;
    error: string;
}

function validateItems(raw: unknown): ValidatedItems | InvalidItems {
    if (!Array.isArray(raw)) {
        return { ok: false, error: "Body must include an 'items' array" };
    }
    if (raw.length === 0) {
        return { ok: false, error: "'items' must contain at least one entry" };
    }

    const items: SecretItem[] = [];
    for (let i = 0; i < raw.length; i++) {
        const entry: unknown = raw[i];
        if (typeof entry !== "object" || entry == null) {
            return { ok: false, error: `items[${i}] must be an object with 'key' and 'value'` };
        }
        const key = "key" in entry ? entry.key : undefined;
        const value = "value" in entry ? entry.value : undefined;
        if (typeof key !== "string" || key.length === 0) {
            return { ok: false, error: `items[${i}].key must be a non-empty string` };
        }
        if (typeof value !== "string" || value.length === 0) {
            return { ok: false, error: `items[${i}].value must be a non-empty string` };
        }
        items.push({ key, value });
    }
    return { ok: true, items };
}

/**
 * Transparently forward a request to Previewkit, returning its response verbatim.
 * `rewriteBody` optionally post-processes the response body - used to rewrite the
 * `statusUrl` in deploy responses to the API's `/v1/previewkit` mount.
 */
async function proxyToPreviewkit(
    c: Context,
    subPath: string,
    rewriteBody?: (body: string) => string,
): Promise<Response> {
    if (!previewkitClient.hasBaseUrl()) {
        return c.json({ error: "Preview environments are not configured." }, 503);
    }

    const method = c.req.method;
    const hasBody = method !== "GET" && method !== "DELETE" && method !== "HEAD";

    let body: ArrayBuffer | undefined;
    if (hasBody) {
        const raw = await c.req.arrayBuffer();
        body = raw.byteLength > 0 ? raw : undefined;
    }

    const search = new URL(c.req.url).search;

    try {
        const result = await previewkitClient.forward({
            method,
            subPath,
            authorization: c.req.header("authorization"),
            contentType: c.req.header("content-type"),
            searchParams: search.startsWith("?") ? search.slice(1) : search,
            body,
        });
        const outBody = rewriteBody != null ? rewriteBody(result.body) : result.body;
        return new Response(outBody, {
            status: result.status,
            headers: { "content-type": result.contentType },
        });
    } catch (err) {
        logger.error("Failed to proxy request to Previewkit", err, { method, subPath });
        return c.json({ error: "Failed to reach Previewkit." }, 502);
    }
}

/**
 * Rewrite the `statusUrl` in a Previewkit deploy response from Previewkit's own
 * `/v1/...` path to the API's public `/v1/previewkit/...` mount, so callers of the
 * autonoma API follow a URL that actually exists here. Returns the body unchanged
 * if it isn't JSON or has no `statusUrl`.
 */
function rewriteDeployStatusUrl(body: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return body;
    }
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) return body;

    const statusUrl = "statusUrl" in parsed ? parsed.statusUrl : undefined;
    if (typeof statusUrl !== "string" || !statusUrl.startsWith("/v1/")) return body;

    return JSON.stringify({ ...parsed, statusUrl: statusUrl.replace(/^\/v1\//, "/v1/previewkit/") });
}
