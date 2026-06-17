import { db } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import type { MarkDiffsGeneratingInput } from "@autonoma/workflow/activities";

/**
 * Transitions the DiffsJob into its `generating` stage just before the diffs
 * workflow starts the refinement loop. The loop now subsumes what the
 * standalone resolution step used to do (its first turn) plus the regeneration
 * turns, so `generating` is the single status that covers the loop's run - it
 * keeps the snapshot timeline advancing past `replaying` while the loop works.
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
