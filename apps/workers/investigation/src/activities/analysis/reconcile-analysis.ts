import { db } from "@autonoma/db";
import { DeployedComparison } from "@autonoma/investigation";
import { type Logger, logger as rootLogger } from "@autonoma/logger";
import type {
    AnalysisCandidateFinding,
    ReconcileAnalysisInput,
    ReconcileAnalysisOutput,
} from "@autonoma/workflow/activities";

/**
 * Reconciler stage. Derives the shadow verdict from the Investigators' candidate findings, produces the
 * shadow-vs-diffs DeployedComparison (reading the authoritative diffs job for the twin's head SHA), and persists
 * both to the shadow store (`AnalysisShadowRun`) - an isolated island that is never a user-facing Bug/Issue.
 * Filing real bugs stays dormant behind authoritative mode until the cutover ships; holistic dedup + rich
 * evidence land with the Reconciler slice.
 */
export async function reconcileAnalysis(input: ReconcileAnalysisInput): Promise<ReconcileAnalysisOutput> {
    const { snapshotId, mode, candidates } = input;
    const clientBugCount = candidates.filter((candidate) => candidate.category === "client_bug").length;
    const testCount = candidates.length;
    // Two-plane verdict, app-health plane only in this slice: a PR is `client_bug` if any test surfaced one.
    const verdict = clientBugCount > 0 ? "client_bug" : "passed";

    // snapshotId is bound to the observability context by the activity interceptor; only non-canonical fields
    // (mode, counts, verdict) go in `extra`.
    const logger = rootLogger.child({
        name: "reconcileAnalysis",
        extra: { mode, testCount, clientBugCount, verdict },
    });
    logger.info("Reconciler stage started");

    // BranchSnapshot has no organizationId of its own - it inherits the org from its branch.
    const twin = await db.branchSnapshot.findUnique({
        where: { id: snapshotId },
        select: { headSha: true, branch: { select: { organizationId: true } } },
    });
    if (twin == null) throw new Error(`Twin snapshot ${snapshotId} not found; cannot reconcile the analysis run`);

    const comparison = await loadComparison(twin.headSha, logger);
    logger.info("Produced DeployedComparison", { extra: comparison });

    await persistShadowRun(
        {
            snapshotId,
            organizationId: twin.branch.organizationId,
            mode,
            verdict,
            testCount,
            clientBugCount,
            candidates,
            comparison,
        },
        logger,
    );

    if (mode === "authoritative") {
        // Filing real Bug/Issue stays dormant until the authoritative cutover ships; log so an accidental
        // authoritative run is visible.
        logger.warn("Authoritative reconcile is not implemented yet; filing no user-facing rows");
    }

    logger.info("Reconciler stage finished; shadow store written, no user-facing rows filed");
    return { verdict, testCount, clientBugCount, comparison, filedCount: 0 };
}

interface PersistShadowRunInput {
    snapshotId: string;
    organizationId: string;
    mode: string;
    verdict: string;
    testCount: number;
    clientBugCount: number;
    candidates: AnalysisCandidateFinding[];
    comparison: ReconcileAnalysisOutput["comparison"];
}

/**
 * Upsert the shadow run record - keyed by the twin snapshot so a re-run overwrites rather than duplicates. The
 * findings are stored as a display blob (not a child table yet); nothing user-facing FKs into this row.
 */
async function persistShadowRun(input: PersistShadowRunInput, logger: Logger): Promise<void> {
    const findings = input.candidates.map((candidate) => ({
        slug: candidate.slug,
        category: candidate.category,
        headline: candidate.headline,
    }));
    const data = {
        mode: input.mode,
        verdict: input.verdict,
        testCount: input.testCount,
        clientBugCount: input.clientBugCount,
        findings,
        deployed: input.comparison,
    };
    await db.analysisShadowRun.upsert({
        where: { snapshotId: input.snapshotId },
        create: { snapshotId: input.snapshotId, organizationId: input.organizationId, ...data },
        update: data,
    });
    logger.info("Persisted shadow analysis run", { extra: { findingCount: findings.length } });
}

/**
 * The deployed (authoritative diffs) agent's outcome for the twin's head SHA, mapped to the comparison shape.
 * Supplementary and best-effort: a missing diffs job or a query error degrades to `found: false` rather than
 * sinking the run.
 */
async function loadComparison(headSha: string | null, logger: Logger): Promise<ReconcileAnalysisOutput["comparison"]> {
    if (headSha == null) {
        logger.warn("Twin has no head SHA; skipping deployed comparison");
        return { found: false, deployedTestCount: 0 };
    }
    try {
        const deployed = await new DeployedComparison(db).byHeadSha(headSha);
        return { found: deployed.found, jobStatus: deployed.jobStatus, deployedTestCount: deployed.perTest.length };
    } catch (error) {
        logger.warn("Deployed comparison unavailable; returning an empty comparison", { err: error });
        return { found: false, deployedTestCount: 0 };
    }
}
