export type CommentTestGenerationForResult = {
    status: string;
    updatedAt: Date;
    testPlan: { testCaseId: string };
};

export type CommentTestAssignmentForResult = {
    testCaseId: string;
    runs: Array<{
        status: string;
        startedAt: Date | null;
        createdAt: Date;
    }>;
};

export type CommentTestStats = {
    selected: number;
    passed: number;
    failed: number;
};

export function collectTestStatsForComment({
    testGenerations,
    testCaseAssignments,
}: {
    testGenerations: CommentTestGenerationForResult[];
    testCaseAssignments: CommentTestAssignmentForResult[];
}): CommentTestStats {
    const latestGenerationByTestCaseId = new Map<string, CommentTestGenerationForResult>();
    const latestRunByTestCaseId = new Map<string, CommentTestAssignmentForResult["runs"][number]>();

    for (const generation of testGenerations) {
        const testCaseId = generation.testPlan.testCaseId;
        const existing = latestGenerationByTestCaseId.get(testCaseId);
        if (existing == null || generation.updatedAt.getTime() > existing.updatedAt.getTime()) {
            latestGenerationByTestCaseId.set(testCaseId, generation);
        }
    }

    for (const assignment of testCaseAssignments) {
        for (const run of assignment.runs) {
            const existing = latestRunByTestCaseId.get(assignment.testCaseId);
            if (existing == null || timeOf(run) > timeOf(existing)) {
                latestRunByTestCaseId.set(assignment.testCaseId, run);
            }
        }
    }

    if (latestRunByTestCaseId.size === 0) {
        return countGenerationFallback(testGenerations);
    }

    let passed = 0;
    let failed = 0;

    for (const assignment of testCaseAssignments) {
        const run = latestRunByTestCaseId.get(assignment.testCaseId);
        if (run != null) {
            if (run.status === "success") passed += 1;
            else if (run.status === "failed") failed += 1;
            continue;
        }

        const generation = latestGenerationByTestCaseId.get(assignment.testCaseId);
        if (generation?.status === "failed") failed += 1;
    }

    return { selected: passed + failed, passed, failed };
}

function countGenerationFallback(testGenerations: CommentTestGenerationForResult[]): CommentTestStats {
    let passed = 0;
    let failed = 0;

    for (const generation of testGenerations) {
        if (generation.status === "success") passed += 1;
        else if (generation.status === "failed") failed += 1;
    }

    return { selected: testGenerations.length, passed, failed };
}

function timeOf(run: { startedAt: Date | null; createdAt: Date }): number {
    return run.startedAt?.getTime() ?? run.createdAt.getTime();
}
