import { writeFile } from "node:fs/promises";
import { logger, runWithSentry } from "@autonoma/logger";
import { TaskQueue } from "@autonoma/workflow";
import { createTemporalWorker } from "@autonoma/workflow/worker";
import * as Sentry from "@sentry/node";
import type { Worker } from "@temporalio/worker";
import * as activities from "./activities";
import { env } from "./env";
import { sentryServiceInterceptor } from "./sentry-service-interceptor";

runWithSentry({ name: "worker-web", dsn: env.SENTRY_DSN_WORKER_WEB }, async () => {
    logger.info("Starting web worker");

    const worker: Worker = await createTemporalWorker({
        taskQueue: TaskQueue.WEB,
        activities,
        maxConcurrentActivityTaskExecutions: 1,
        interceptors: {
            activity: [sentryServiceInterceptor],
        },
    });

    await writeFile("/tmp/worker-ready", "1");

    logger.info("Web worker ready, polling for activities", { taskQueue: TaskQueue.WEB });

    const runPromise = worker.run();

    let shuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;

        logger.info("Received shutdown signal, stopping web worker", { signal, taskQueue: TaskQueue.WEB });

        try {
            await worker.shutdown();
            await runPromise;
            logger.info("Web worker shutdown complete", { signal, taskQueue: TaskQueue.WEB });
            await Sentry.flush(2000);
            process.exit(0);
        } catch (error) {
            logger.error("Web worker shutdown failed", error, { signal, taskQueue: TaskQueue.WEB });
            await Sentry.flush(2000);
            process.exit(1);
        }
    };

    process.once("SIGTERM", () => {
        void shutdown("SIGTERM");
    });

    process.once("SIGINT", () => {
        void shutdown("SIGINT");
    });

    await runPromise;
});
