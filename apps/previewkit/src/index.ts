import { runWithSentry } from "@autonoma/logger";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createPreviewkitServices } from "./create-services";
import { env } from "./env";
import { logger } from "./logger";

runWithSentry({ name: "previewkit", dsn: env.SENTRY_DSN }, async () => {
    const { previewPipeline, teardownPipeline, githubProvider } = await createPreviewkitServices();

    // HTTP server. All /v1/* routes require either the API-key Bearer
    // header (external callers) or the service shared secret (internal
    // service-to-service from the autonoma API). /health stays open for
    // kubelet probes.
    const app = createApp({
        previewPipeline,
        teardownPipeline,
        gitProvider: githubProvider,
        serviceSecret: env.AUTONOMA_SERVICE_SECRET,
        useTemporal: env.PREVIEWKIT_USE_TEMPORAL,
    });

    const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
        logger.info(`Previewkit listening on http://localhost:${info.port}`);
    });

    await new Promise<void>((resolve) => {
        const shutdown = (signal: NodeJS.Signals) => {
            logger.info("Shutting down...", { signal });
            server.close();
            resolve();
        };
        process.once("SIGTERM", () => shutdown("SIGTERM"));
        process.once("SIGINT", () => shutdown("SIGINT"));
    });
});
