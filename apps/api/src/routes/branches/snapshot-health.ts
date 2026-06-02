import type { PrismaClient } from "@autonoma/db";
import { type Logger, logger as rootLogger } from "@autonoma/logger";

export type SnapshotHealth = "healthy" | "critical" | "running" | "unknown";

export interface SnapshotHealthCounts {
    failing: number;
    passing: number;
    running: number;
    quarantined: number;
    notAffected: number;
    totalTests: number;
}

export interface SnapshotHealthResult {
    health: SnapshotHealth;
    counts: SnapshotHealthCounts;
}

export function computeSnapshotHealth(snapshotStatus: string, counts: SnapshotHealthCounts): SnapshotHealth {
    // A cancelled snapshot was abandoned (superseded by a newer request); its
    // partial run results are not meaningful health signal.
    if (snapshotStatus === "cancelled") return "unknown";
    if (snapshotStatus === "failed") return "critical";
    if (counts.failing > 0 || counts.quarantined > 0) return "critical";
    if (counts.running > 0 || snapshotStatus === "processing") return "running";
    if (counts.passing > 0 || counts.notAffected > 0) return "healthy";
    return "unknown";
}

export async function aggregateSnapshotHealth(
    db: PrismaClient,
    snapshotsWithStatus: Array<{ id: string; status: string }>,
    parentLogger?: Logger,
): Promise<Map<string, SnapshotHealthResult>> {
    const logger = (parentLogger ?? rootLogger).child({ name: "aggregateSnapshotHealth" });
    if (snapshotsWithStatus.length === 0) return new Map();

    const snapshotIds = snapshotsWithStatus.map((s) => s.id);
    logger.info("Aggregating snapshot health", { count: snapshotIds.length });

    const [assignments, runs] = await Promise.all([
        db.testCaseAssignment.findMany({
            where: { snapshotId: { in: snapshotIds } },
            select: { snapshotId: true, testCaseId: true, quarantineIssueId: true },
        }),
        db.run.findMany({
            where: { assignment: { snapshotId: { in: snapshotIds } } },
            select: {
                status: true,
                startedAt: true,
                createdAt: true,
                assignment: { select: { snapshotId: true, testCaseId: true } },
            },
        }),
    ]);

    type RunRow = (typeof runs)[number];
    const latestRunByTest = new Map<string, Map<string, RunRow>>();

    function timeOf(run: RunRow): number {
        return run.startedAt?.getTime() ?? run.createdAt.getTime();
    }

    for (const run of runs) {
        const snapId = run.assignment.snapshotId;
        const testId = run.assignment.testCaseId;
        let perSnap = latestRunByTest.get(snapId);
        if (perSnap == null) {
            perSnap = new Map();
            latestRunByTest.set(snapId, perSnap);
        }
        const existing = perSnap.get(testId);
        if (existing == null || timeOf(run) > timeOf(existing)) {
            perSnap.set(testId, run);
        }
    }

    const result = new Map<string, SnapshotHealthResult>();
    for (const snapshot of snapshotsWithStatus) {
        const snapAssignments = assignments.filter((a) => a.snapshotId === snapshot.id);
        const totalTests = snapAssignments.length;

        const quarantinedSet = new Set<string>();
        for (const a of snapAssignments) {
            if (a.quarantineIssueId != null) quarantinedSet.add(a.testCaseId);
        }

        let failing = 0;
        let passing = 0;
        let running = 0;
        const perSnapRuns = latestRunByTest.get(snapshot.id);
        if (perSnapRuns != null) {
            for (const [testId, run] of perSnapRuns) {
                if (quarantinedSet.has(testId)) continue;
                if (run.status === "failed") failing += 1;
                else if (run.status === "success") passing += 1;
                else if (run.status === "running" || run.status === "pending") running += 1;
            }
        }

        const quarantined = quarantinedSet.size;
        const replayed = failing + passing + running;
        const notAffected = Math.max(totalTests - quarantined - replayed, 0);

        const counts: SnapshotHealthCounts = { failing, passing, running, quarantined, notAffected, totalTests };
        result.set(snapshot.id, {
            health: computeSnapshotHealth(snapshot.status, counts),
            counts,
        });
    }

    return result;
}
