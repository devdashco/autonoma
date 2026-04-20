import { db } from "@autonoma/db";
import { logger } from "@autonoma/logger";
import { runReplayReview } from "./run";

const runIdArg = process.argv[2];
if (runIdArg == null) {
    console.error("Usage: replay-reviewer <runId>");
    process.exit(1);
}
const runId: string = runIdArg;

try {
    await runReplayReview(runId);
    process.exit(0);
} catch (error) {
    logger.fatal("Replay reviewer failed", error);

    try {
        await db.runReview.update({
            where: { runId },
            data: { status: "failed" },
        });
    } catch (updateError) {
        logger.error("Failed to update review status to failed", updateError);
    }

    process.exit(1);
}
