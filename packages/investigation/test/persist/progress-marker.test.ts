import { expect } from "vitest";
import { InvestigationProgressMarker } from "../../src";
import { investigationDbSuite } from "../harness";

investigationDbSuite({
    name: "InvestigationProgressMarker",
    cases: (test) => {
        test("seeds a running row, advances the stage, then flips to failed - never writing the report header", async ({
            harness,
            seedResult: { organizationId, application },
        }) => {
            const { snapshotId } = await harness.setupTestCase(organizationId, application.id, "progress-flow");
            const marker = new InvestigationProgressMarker(harness.db);

            // Start of a run: a bare running row with no findings/header yet.
            await marker.mark({ snapshotId, organizationId, status: "running", stage: "selecting" });
            let row = await harness.db.investigationReport.findUniqueOrThrow({ where: { snapshotId } });
            expect(row.status).toBe("running");
            expect(row.stage).toBe("selecting");
            expect(row.appSlug).toBeNull();
            expect(row.testCount).toBe(0);

            // A later stage updates in place (still one row, PK is the snapshot).
            await marker.mark({ snapshotId, organizationId, status: "running", stage: "running" });
            row = await harness.db.investigationReport.findUniqueOrThrow({ where: { snapshotId } });
            expect(row.status).toBe("running");
            expect(row.stage).toBe("running");

            // A run that dies before the report: failed, and the stage is cleared.
            await marker.mark({ snapshotId, organizationId, status: "failed" });
            row = await harness.db.investigationReport.findUniqueOrThrow({ where: { snapshotId } });
            expect(row.status).toBe("failed");
            expect(row.stage).toBeNull();
        });

        test("a failed mark never downgrades an already-completed report", async ({
            harness,
            seedResult: { organizationId, application },
        }) => {
            const { snapshotId } = await harness.setupTestCase(organizationId, application.id, "progress-completed");
            const marker = new InvestigationProgressMarker(harness.db);

            await marker.mark({ snapshotId, organizationId, status: "running", stage: "reporting" });
            // The report writer lands its completed row (stage cleared).
            await harness.db.investigationReport.update({
                where: { snapshotId },
                data: { status: "completed", stage: null },
            });

            // A lost activity result after the report committed triggers the workflow's failed catch - it must
            // NOT overwrite the good report.
            await marker.mark({ snapshotId, organizationId, status: "failed" });

            const row = await harness.db.investigationReport.findUniqueOrThrow({ where: { snapshotId } });
            expect(row.status).toBe("completed");
        });

        test("a failed mark never creates a row for a run that never seeded one", async ({
            harness,
            seedResult: { organizationId, application },
        }) => {
            const { snapshotId } = await harness.setupTestCase(organizationId, application.id, "progress-noseed");
            const marker = new InvestigationProgressMarker(harness.db);

            await marker.mark({ snapshotId, organizationId, status: "failed" });

            const row = await harness.db.investigationReport.findUnique({ where: { snapshotId } });
            expect(row).toBeNull();
        });
    },
});
