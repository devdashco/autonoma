export interface TestSuiteChangeRow {
    testCase: { id: string; name: string; slug: string };
    latestSnapshotId: string;
    latestSnapshotShortSha: string;
}

export interface TestSuiteChanges {
    added: TestSuiteChangeRow[];
    modified: TestSuiteChangeRow[];
    removed: TestSuiteChangeRow[];
}

interface TestSuiteAssignment {
    testCaseId: string;
    planId: string | null;
    testCase: { id: string; name: string; slug: string };
}

interface TestSuiteSnapshot {
    id: string;
    headSha: string | null;
    testCaseAssignments: TestSuiteAssignment[];
}

export function emptyTestSuiteChanges(): TestSuiteChanges {
    return { added: [], modified: [], removed: [] };
}

export function computeTestSuiteChanges({
    prSnapshots,
    baseSnap,
    activeSnap,
}: {
    prSnapshots: TestSuiteSnapshot[];
    baseSnap: TestSuiteSnapshot;
    activeSnap: TestSuiteSnapshot;
}): TestSuiteChanges {
    const baseMap = indexByTestCase(baseSnap);
    const activeMap = indexByTestCase(activeSnap);
    const prIndex: Array<Map<string, TestSuiteAssignment>> = prSnapshots.map((s) => indexByTestCase(s));
    const snapshotLookup = {
        prSnapshots,
        prIndex,
        baseMap,
        activeSnap,
    };

    const added: TestSuiteChangeRow[] = [];
    const modified: TestSuiteChangeRow[] = [];
    const removed: TestSuiteChangeRow[] = [];

    for (const [testCaseId, ass] of activeMap) {
        const baseAss = baseMap.get(testCaseId);

        if (baseAss == null) {
            const snap = findLatestPlanChange(testCaseId, snapshotLookup);
            added.push({
                testCase: ass.testCase,
                latestSnapshotId: snap.id,
                latestSnapshotShortSha: shortShaOf(snap),
            });
            continue;
        }

        if (baseAss.planId !== ass.planId) {
            const snap = findLatestPlanChange(testCaseId, snapshotLookup);
            modified.push({
                testCase: ass.testCase,
                latestSnapshotId: snap.id,
                latestSnapshotShortSha: shortShaOf(snap),
            });
        }
    }

    for (const [testCaseId, baseAss] of baseMap) {
        if (activeMap.has(testCaseId)) continue;
        const snap = findLatestPlanChange(testCaseId, snapshotLookup);
        removed.push({
            testCase: baseAss.testCase,
            latestSnapshotId: snap.id,
            latestSnapshotShortSha: shortShaOf(snap),
        });
    }

    return { added, modified, removed };
}

function indexByTestCase(snap: TestSuiteSnapshot): Map<string, TestSuiteAssignment> {
    return new Map(snap.testCaseAssignments.map((a) => [a.testCaseId, a]));
}

function shortShaOf(snap: TestSuiteSnapshot): string {
    return snap.headSha != null ? snap.headSha.slice(0, 8) : "?";
}

function prevAssignmentFor(
    testCaseId: string,
    prIdx: number,
    {
        prIndex,
        baseMap,
    }: {
        prIndex: Array<Map<string, TestSuiteAssignment>>;
        baseMap: Map<string, TestSuiteAssignment>;
    },
): TestSuiteAssignment | undefined {
    const prevIndex = prIdx === 0 ? baseMap : prIndex[prIdx - 1];
    return prevIndex?.get(testCaseId);
}

function findLatestPlanChange(
    testCaseId: string,
    lookup: {
        prSnapshots: TestSuiteSnapshot[];
        prIndex: Array<Map<string, TestSuiteAssignment>>;
        baseMap: Map<string, TestSuiteAssignment>;
        activeSnap: TestSuiteSnapshot;
    },
): TestSuiteSnapshot {
    for (let i = lookup.prSnapshots.length - 1; i >= 0; i -= 1) {
        const snap = lookup.prSnapshots[i];
        if (snap == null) continue;
        const cur = lookup.prIndex[i]?.get(testCaseId);
        const prev = prevAssignmentFor(testCaseId, i, lookup);
        if ((cur?.planId ?? null) !== (prev?.planId ?? null)) return snap;
    }
    return lookup.activeSnap;
}
