import { db } from "@autonoma/db";
import { assertSnapshotPending } from "@autonoma/investigation";
import { logger as rootLogger } from "@autonoma/logger";
import type {
    AnalysisInvestigationTarget,
    RunImpactAnalysisInput,
    RunImpactAnalysisOutput,
} from "@autonoma/workflow/activities";
import { selectInvestigationTests } from "../select-tests";

/**
 * Impact Analysis stage. Reuses the existing selection: it fails fast unless the twin is a `processing` detached
 * snapshot (later stages read its frozen baseline), then selects the tests the PR's diff affects - materializing
 * one shadow generation per runnable test - and hands them to the Investigator fan-out. Up-front new-test
 * materialization and the DiffsAgent rename land with the Impact Analysis Agent slice.
 */
export async function runImpactAnalysis(input: RunImpactAnalysisInput): Promise<RunImpactAnalysisOutput> {
    const { snapshotId, mode } = input;
    // snapshotId (+ the snapshot graph) is bound to the observability context by the activity interceptor, so
    // it lands on every log automatically; only the non-canonical `mode` goes in `extra`.
    const logger = rootLogger.child({ name: "runImpactAnalysis", extra: { mode } });
    logger.info("Impact Analysis stage started");

    // The whole pipeline assumes a detached, still-pending twin. Assert it up front so a misrouted active
    // snapshot fails immediately rather than deep in the selection clone + LLM call.
    await assertSnapshotPending(db, snapshotId);

    const selection = await selectInvestigationTests({ snapshotId });
    const targets: AnalysisInvestigationTarget[] = selection.tests.map((test) => ({
        slug: test.slug,
        testGenerationId: test.testGenerationId,
        scenarioId: test.scenarioId,
        reason: test.reason,
    }));

    logger.info("Impact Analysis stage finished", { extra: { targetCount: targets.length } });
    return { targets };
}
