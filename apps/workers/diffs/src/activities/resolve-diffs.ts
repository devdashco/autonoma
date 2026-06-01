import { db } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import type { ResolveDiffsInput } from "@autonoma/workflow/activities";
import { Context } from "@temporalio/activity";
import { withCodebaseForSnapshot } from "../codebase/resolve";
import { runDiffsResolution } from "../resolution/run-resolution";

export async function resolveDiffs({ snapshotId }: ResolveDiffsInput): Promise<void> {
    const logger = rootLogger.child({ name: "resolveDiffs" });
    logger.info("Starting diffs resolution");

    const heartbeat = setInterval(() => Context.current().heartbeat(), 30_000);

    try {
        await db.diffsJob.update({
            where: { snapshotId },
            data: { status: "resolving" },
        });

        const { reasoning, conversationUrl } = await withCodebaseForSnapshot(snapshotId, {
            targetDirSeed: `resolution-${snapshotId}`,
            body: (codebase) => runDiffsResolution({ snapshotId, codebase }),
        });

        await db.diffsJob.update({
            where: { snapshotId },
            data: {
                resolutionReasoning: reasoning,
                resolutionConversationUrl: conversationUrl,
                status: "generating",
            },
        });

        logger.info("Diffs resolution activity completed");
    } catch (error) {
        await db.diffsJob.update({
            where: { snapshotId },
            data: {
                status: "failed",
                failureReason: error instanceof Error ? error.message : String(error),
                completedAt: new Date(),
            },
        });
        throw error;
    } finally {
        clearInterval(heartbeat);
    }
}
