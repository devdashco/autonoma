import { db } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import type { MarkDiffsGeneratingInput } from "@autonoma/workflow/activities";

/**
 * Transitions the DiffsJob into its `generating` stage just before the diffs
 * workflow starts the refinement loop. The loop generates + heals both the
 * affected tests and the tests the diffs agent authored, so `generating` is the
 * single status that covers the loop's run and keeps the snapshot timeline
 * advancing while the loop works.
 */
export async function markDiffsGenerating({ snapshotId }: MarkDiffsGeneratingInput): Promise<void> {
    const logger = rootLogger.child({ name: "markDiffsGenerating" });
    logger.info("Marking diffs job as generating");

    await db.diffsJob.update({
        where: { snapshotId },
        data: { status: "generating" },
    });

    logger.info("Diffs job marked generating");
}
