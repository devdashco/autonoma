import type { PrismaClient } from "@autonoma/db";
import { type Logger, logger as rootLogger } from "@autonoma/logger";

/** Coarse, de-escalated lifecycle stages surfaced while an investigation runs (the PR entry point shows these). */
export type InvestigationStage = "selecting" | "running" | "reporting";

export interface MarkProgressInput {
    /** The investigation twin snapshot (the report's primary key). */
    snapshotId: string;
    organizationId: string;
    status: "running" | "failed";
    /** The current coarse stage while running; omitted (cleared) on a terminal failure. */
    stage?: InvestigationStage;
}

/**
 * Writes ONLY the report row's lifecycle fields (status + stage), never the findings/header the final report
 * writer owns. It seeds a bare `running` row at the start of a run - so the PR entry point can show "running"
 * before any finding exists - and flips it to `failed` if the workflow dies before the report is written. The
 * `completed` transition (and clearing the stage) is deliberately NOT here: that is the report writer's job
 * (InvestigationReportPersister), which owns the row once real results exist.
 *
 * Keyed to the twin snapshot, so the create branch leaves the denormalized header null; the read path treats an
 * appSlug-less row as "running, no data yet" and renders the graceful in-flight state.
 */
export class InvestigationProgressMarker {
    private readonly logger: Logger;

    constructor(private readonly db: PrismaClient) {
        this.logger = rootLogger.child({ name: this.constructor.name });
    }

    async mark(input: MarkProgressInput): Promise<void> {
        const { snapshotId, organizationId, status, stage } = input;
        this.logger.info("Marking investigation progress", {
            snapshot: { snapshotId },
            extra: { status, stage },
        });

        if (status === "failed") {
            // Conditional, non-creating downgrade: only flip a row that is NOT already completed, and never
            // create one. This guards the case where writeInvestigationReport's transaction COMMITTED (row is
            // completed) but its activity result was then lost (worker crash mid-return; maximumAttempts: 1, so
            // no retry) - the workflow's catch would otherwise flip a good report to "failed". A run that never
            // even seeded a row (its "running" mark failed) also correctly stays absent rather than gaining a
            // spurious failed row.
            await this.db.investigationReport.updateMany({
                where: { snapshotId, status: { not: "completed" } },
                data: { status: "failed", stage: null, stageUpdatedAt: new Date() },
            });
            return;
        }

        // Running: seed the row if absent, else advance the stage in place. `null` (not undefined) is required to
        // CLEAR the stage on Prisma, though the running path always carries one.
        await this.db.investigationReport.upsert({
            where: { snapshotId },
            create: { snapshotId, organizationId, status, stage: stage ?? null, stageUpdatedAt: new Date() },
            update: { status, stage: stage ?? null, stageUpdatedAt: new Date() },
        });
    }
}
