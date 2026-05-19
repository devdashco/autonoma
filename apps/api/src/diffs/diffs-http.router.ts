import { db } from "@autonoma/db";
import { BadRequestError, NotFoundError } from "@autonoma/errors";
import { logger as rootLogger } from "@autonoma/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { verifyApiKeyAndGetContext } from "../application-setup/verify-api-key";
import { env } from "../env";
import { diffsTriggerService as service } from "./diffs-service";

const triggerDiffsBodySchema = z.object({
    repo_id: z.number(),
    pr_number: z.number().int().positive().optional(),
    github_ref: z.string().min(1),
    url: z.url(),
    webhook_url: z.url().optional(),
    webhook_headers: z.record(z.string(), z.string()).optional(),
    environment: z.string().optional(),
});

const triggerDiffsInternalBodySchema = z.object({
    organization_id: z.string().min(1),
    repo_id: z.number(),
    pr_number: z.number().int().positive(),
    url: z.url(),
});

export const diffsHttpRouter = new Hono();

// External: called by CI/CD pipelines (API key auth)
diffsHttpRouter.use("/trigger", cors({ origin: "*" }));

diffsHttpRouter.post("/trigger", async (ctx) => {
    const logger = rootLogger.child({ name: "diffsHttpRouter.trigger" });
    logger.info("Received diffs trigger request");

    const apiKeyCtx = await verifyApiKeyAndGetContext(db, ctx.req.header("authorization"));
    if (apiKeyCtx == null) {
        return ctx.json({ error: "Unauthorized" }, 401);
    }

    const parsed = triggerDiffsBodySchema.safeParse(await ctx.req.json());
    if (!parsed.success) {
        return ctx.json({ error: "Invalid request body", details: z.treeifyError(parsed.error) }, 400);
    }
    const body = parsed.data;

    try {
        const result = await service.triggerDiffs({
            organizationId: apiKeyCtx.organizationId,
            repoId: body.repo_id,
            prNumber: body.pr_number,
            githubRef: body.github_ref,
            url: body.url,
            webhookUrl: body.webhook_url,
            webhookHeaders: body.webhook_headers,
            environment: body.environment,
        });

        return ctx.json({ ok: true, ...result });
    } catch (error) {
        if (error instanceof BadRequestError) {
            return ctx.json({ error: error.message }, 400);
        }
        if (error instanceof NotFoundError) {
            return ctx.json({ error: error.message }, 404);
        }

        logger.fatal("Failed to trigger diffs analysis", error, {
            repoId: body.repo_id,
            prNumber: body.pr_number,
            githubRef: body.github_ref,
        });
        return ctx.json({ error: "Failed to trigger diffs analysis" }, 500);
    }
});

// Internal: called by Previewkit after deploy (service token auth)
diffsHttpRouter.post("/internal/trigger", async (ctx) => {
    const logger = rootLogger.child({ name: "diffsHttpRouter.internalTrigger" });
    logger.info("Received internal diffs trigger request");

    const secret = ctx.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (env.PREVIEWKIT_SERVICE_SECRET == null || secret !== env.PREVIEWKIT_SERVICE_SECRET) {
        return ctx.json({ error: "Unauthorized" }, 401);
    }

    const parsed = triggerDiffsInternalBodySchema.safeParse(await ctx.req.json());
    if (!parsed.success) {
        return ctx.json({ error: "Invalid request body", details: z.treeifyError(parsed.error) }, 400);
    }
    const body = parsed.data;

    try {
        await service.triggerPrDiffs({
            organizationId: body.organization_id,
            repoId: body.repo_id,
            prNumber: body.pr_number,
            url: body.url,
        });

        return ctx.json({ ok: true });
    } catch (error) {
        if (error instanceof BadRequestError) {
            return ctx.json({ error: error.message }, 400);
        }
        if (error instanceof NotFoundError) {
            return ctx.json({ error: error.message }, 404);
        }

        logger.error("Failed to trigger diffs analysis from internal call", error, {
            organizationId: body.organization_id,
            repoId: body.repo_id,
            prNumber: body.pr_number,
        });
        return ctx.json({ error: "Failed to trigger diffs analysis" }, 500);
    }
});
