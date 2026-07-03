import { db } from "@autonoma/db";
import { InvestigationProgressMarker } from "@autonoma/investigation";
import { logger as rootLogger } from "@autonoma/logger";
import type { MarkInvestigationProgressInput } from "@autonoma/workflow/activities";
import { resolveSnapshotMeta } from "../codebase/resolve";

/**
 * Write the report row's lifecycle fields (status + coarse stage) so the PR entry point can show an investigation
 * is running / where it is / that it failed - before the final report exists. Best-effort by contract: the
 * workflow calls this fire-and-forget and never lets a progress-write sink the run, so any failure is logged and
 * swallowed here rather than propagated. Resolves the org from the snapshot (same as the report writer).
 */
export async function markInvestigationProgress(input: MarkInvestigationProgressInput): Promise<void> {
    const { snapshotId, status, stage } = input;
    const logger = rootLogger.child({
        name: "markInvestigationProgress",
        snapshot: { snapshotId },
        extra: { status, stage },
    });
    try {
        const meta = await resolveSnapshotMeta(snapshotId);
        await new InvestigationProgressMarker(db).mark({
            snapshotId,
            organizationId: meta.organizationId,
            status,
            stage,
        });
    } catch (error) {
        // Progress is a display nicety - never let a failed status-write affect the run. Log and move on.
        logger.warn("Could not mark investigation progress; continuing", { err: error });
    }
}
