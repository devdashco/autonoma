import type { Logger } from "@autonoma/logger";
import type { ReportTestStatus, SnapshotReportResults, SnapshotReportTestResult } from "@autonoma/types";
import type { SnapshotExecutedTest } from "./snapshot-executed-tests";

// The checkpoint report header ("X tests run, Y passed, Z failed"), the executed-tests list
// rendered below it, the checkpoint history rail, and the cumulative PR card must all agree.
// They diverged because this block counted raw `Run` rows directly (ignoring the refinement
// loop and quarantine, and counting superseded runs), while every other surface derives from
// `listExecutedTestsForSnapshot`. We now build the results block from that same canonical
// source so every surface reports the same numbers.
export function buildResultsBlock(executedTests: SnapshotExecutedTest[], parentLogger: Logger): SnapshotReportResults {
    const logger = parentLogger.child({ name: "buildResultsBlock" });

    const tests: SnapshotReportTestResult[] = executedTests.map((test) => ({
        testCaseId: test.testCase.id,
        name: test.testCase.name,
        slug: test.testCase.slug,
        status: reportStatusForExecutedTest(test),
        runId: test.runId ?? undefined,
        durationMs: durationForTest(test),
    }));

    const phaseDurationMs = runPhaseDuration(executedTests);
    const counts = countResults(tests);

    logger.info("Built results block", {
        extra: { executedTests: executedTests.length, phaseDurationMs },
    });

    return {
        durationMs: phaseDurationMs != null && phaseDurationMs > 0 ? phaseDurationMs : undefined,
        passed: counts.passed,
        failed: counts.failed,
        pending: counts.pending,
        running: counts.running,
        total: tests.length,
        tests,
    };
}

function reportStatusForExecutedTest(test: SnapshotExecutedTest): ReportTestStatus {
    if (test.finalOutcome === "passed") return "passed";
    if (test.finalOutcome === "failed") return "failed";
    if (test.status === "running" || test.status === "queued") return "running";
    return "pending";
}

function durationForTest(test: SnapshotExecutedTest): number | undefined {
    if (test.startedAt == null || test.completedAt == null) return undefined;
    return test.completedAt.getTime() - test.startedAt.getTime();
}

function countResults(tests: SnapshotReportTestResult[]) {
    let passed = 0;
    let failed = 0;
    let running = 0;
    let pending = 0;

    for (const test of tests) {
        if (test.status === "passed") passed += 1;
        else if (test.status === "failed") failed += 1;
        else if (test.status === "running") running += 1;
        else pending += 1;
    }

    return { passed, failed, pending, running };
}

function runPhaseDuration(tests: Array<{ startedAt: Date | null; completedAt: Date | null }>): number | undefined {
    const startTimes = tests.map((t) => t.startedAt?.getTime()).filter((t): t is number => t != null);
    const endTimes = tests.map((t) => t.completedAt?.getTime()).filter((t): t is number => t != null);
    return startTimes.length > 0 && endTimes.length > 0 ? Math.max(...endTimes) - Math.min(...startTimes) : undefined;
}
