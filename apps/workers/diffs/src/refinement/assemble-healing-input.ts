import { type PrismaClient, db } from "@autonoma/db";
import {
    type FailureRecord,
    type FlowSummary,
    type HealingAction,
    type HealingInput,
    type HealingReviewLink,
    type PlanAuthoringInput,
    ScenarioIndex,
    healingActionSchema,
} from "@autonoma/diffs";
import { logger as rootLogger } from "@autonoma/logger";
import type { GenerationOutcomeFailure, RunOutcomeFailure } from "@autonoma/workflow/activities";

/** Everything {@link HealingAgent} needs except the on-disk codebase clone. */
export type HealingInputWithoutCodebase = Omit<HealingInput, "codebase">;

export interface AssembleHealingInputParams {
    iterationId: string;
    iterationNumber: number;
    snapshotId: string;
    failuresAtGeneration: GenerationOutcomeFailure[];
    failuresAtReplay: RunOutcomeFailure[];
}

export interface AssembledHealingInput {
    /** Ready to spread into `HealingAgent.run` once the caller adds a `codebase`. */
    agentInput: HealingInputWithoutCodebase;
    /** Convenience meta the runner uses for downstream wiring (TestSuiteUpdater, persistence). */
    meta: {
        snapshotId: string;
        organizationId: string;
        applicationId: string;
        iterationNumber: number;
    };
}

/**
 * Assemble the full {@link HealingInput} (minus the codebase) from already
 * bucketed iteration outcomes.
 *
 * This is the single shared loader used by both the production refinement
 * runner and the eval-capture utility:
 *
 *  - The runner forwards its activity input (analyzeResults already bucketed
 *    failures upstream) straight into the live agent.
 *  - Capture buckets the iteration's outcomes via {@link bucketIterationOutcomes}
 *    first, then feeds the result here; the resulting `agentInput` is frozen
 *    to disk for the eval to rehydrate later.
 *
 * Loading scenarios + flows + scope guidelines reads the application's
 * *current* state. Eval cases captured by id are therefore snapshots of what
 * the agent would see at capture time, not literally what the live iteration
 * saw - acceptable for the eval contract (priorActions and failures, the
 * inputs the rubric grades against, are reconstructed exactly).
 */
export async function assembleHealingInput(params: AssembleHealingInputParams): Promise<AssembledHealingInput> {
    const logger = rootLogger.child({ name: "assembleHealingInput" });
    const { iterationId, iterationNumber, snapshotId, failuresAtGeneration, failuresAtReplay } = params;

    const { applicationId, organizationId } = await loadSnapshotApplication(snapshotId);

    logger.info("Loading healing assembly inputs", {
        extra: {
            iterationId,
            iterationNumber,
            snapshotId,
            failureCount: failuresAtGeneration.length + failuresAtReplay.length,
        },
    });

    const [priorActions, planAuthoring] = await Promise.all([
        loadPriorActions(iterationId),
        loadPlanAuthoringInput({ db, applicationId, snapshotId }),
    ]);

    const failures = collectFailureRecords(failuresAtGeneration, failuresAtReplay);
    const reportableReviewLinks = computeReportableReviewLinks(failuresAtGeneration, failuresAtReplay);

    const agentInput: HealingInputWithoutCodebase = {
        iteration: iterationNumber,
        priorActions,
        failures,
        reportableReviewLinks,
        planAuthoring,
        snapshotId,
        applicationId,
        organizationId,
    };

    return { agentInput, meta: { snapshotId, organizationId, applicationId, iterationNumber } };
}

async function loadSnapshotApplication(snapshotId: string): Promise<{ applicationId: string; organizationId: string }> {
    const snapshot = await db.branchSnapshot.findUniqueOrThrow({
        where: { id: snapshotId },
        select: {
            branch: {
                select: {
                    application: { select: { id: true, organizationId: true } },
                },
            },
        },
    });
    return {
        applicationId: snapshot.branch.application.id,
        organizationId: snapshot.branch.application.organizationId,
    };
}

/** Read every action emitted by *earlier* iterations of the same loop, in emission order. */
export async function loadPriorActions(currentIterationId: string): Promise<HealingAction[]> {
    const current = await db.refinementIteration.findUniqueOrThrow({
        where: { id: currentIterationId },
        select: { loopId: true, number: true },
    });

    const priorRows = await db.refinementAction.findMany({
        where: { iteration: { loopId: current.loopId, number: { lt: current.number } } },
        select: { kind: true, payload: true },
        orderBy: { createdAt: "asc" },
    });

    return priorRows.map((row) => healingActionSchema.parse({ kind: row.kind, ...(row.payload as object) }));
}

/**
 * Map each reportable testCaseId to the source review its report action links
 * evidence to. A generation failure links to its generation review, a replay
 * failure to its run review; when a test case failed at both stages the
 * generation review wins.
 */
export function computeReportableReviewLinks(
    failuresAtGeneration: GenerationOutcomeFailure[],
    failuresAtReplay: RunOutcomeFailure[],
): Map<string, HealingReviewLink> {
    const reviewLinks = new Map<string, HealingReviewLink>();
    for (const f of failuresAtGeneration) {
        if (f.generationReviewId != null && !reviewLinks.has(f.testCaseId)) {
            reviewLinks.set(f.testCaseId, { generationReviewId: f.generationReviewId });
        }
    }
    for (const f of failuresAtReplay) {
        if (f.runReviewId != null && !reviewLinks.has(f.testCaseId)) {
            reviewLinks.set(f.testCaseId, { runReviewId: f.runReviewId });
        }
    }
    return reviewLinks;
}

/** Project bucketed gen/run failures into the {@link FailureRecord} shape the agent reads. */
export function collectFailureRecords(
    failuresAtGeneration: GenerationOutcomeFailure[],
    failuresAtReplay: RunOutcomeFailure[],
): FailureRecord[] {
    const fromGen: FailureRecord[] = failuresAtGeneration.map((f) => ({
        key: f.failureKey,
        source: "generation",
        testCaseId: f.testCaseId,
        testCaseSlug: f.testCaseSlug,
        testCaseName: f.testCaseName,
        planId: f.planId,
        planPrompt: f.planPrompt,
        verdict: f.verdict,
        verdictKind: f.verdictKind,
        sourceId: f.sourceId,
        sourceStatus: f.sourceStatus,
        reviewReasoning: f.reviewReasoning,
    }));
    const fromRun: FailureRecord[] = failuresAtReplay.map((f) => ({
        key: f.failureKey,
        source: "replay",
        testCaseId: f.testCaseId,
        testCaseSlug: f.testCaseSlug,
        testCaseName: f.testCaseName,
        planId: f.planId,
        planPrompt: f.planPrompt,
        verdict: f.verdict,
        verdictKind: f.verdictKind,
        sourceId: f.sourceId,
        sourceStatus: f.sourceStatus,
        reviewReasoning: f.reviewReasoning,
    }));
    return [...fromGen, ...fromRun];
}

export async function loadPlanAuthoringInput({
    db,
    applicationId,
    snapshotId,
}: {
    db: PrismaClient;
    applicationId: string;
    snapshotId: string;
}): Promise<PlanAuthoringInput> {
    const [scenarios, flows, application] = await Promise.all([
        loadScenarioIndex(db, applicationId),
        loadFlowSummaries(db, applicationId, snapshotId),
        db.application.findUniqueOrThrow({
            where: { id: applicationId },
            select: { testScopeGuidelines: true },
        }),
    ]);
    return {
        scenarios,
        flows,
        testScopeGuidelines: application.testScopeGuidelines ?? undefined,
    };
}

async function loadScenarioIndex(db: PrismaClient, applicationId: string): Promise<ScenarioIndex> {
    const scenarios = await db.scenario.findMany({
        where: { applicationId, isDisabled: false },
        select: {
            id: true,
            name: true,
            description: true,
            activeRecipeVersion: {
                select: { fingerprint: true, fixtureJson: true, validationStatus: true },
            },
            instances: {
                where: { status: "UP_SUCCESS" },
                orderBy: { upAt: "desc" },
                take: 3,
                select: { metadata: true },
            },
        },
    });

    const details = scenarios.map((s) => {
        const sample = s.instances.find((i) => i.metadata != null);
        return {
            id: s.id,
            name: s.name,
            description: s.description ?? undefined,
            activeRecipe:
                s.activeRecipeVersion != null
                    ? {
                          fingerprint: s.activeRecipeVersion.fingerprint,
                          fixtureJson: s.activeRecipeVersion.fixtureJson,
                          validationStatus: s.activeRecipeVersion.validationStatus,
                      }
                    : undefined,
            sampleMetadata: sample?.metadata ?? undefined,
        };
    });

    return new ScenarioIndex(details);
}

async function loadFlowSummaries(db: PrismaClient, applicationId: string, snapshotId: string): Promise<FlowSummary[]> {
    const folders = await db.folder.findMany({
        where: { applicationId },
        select: { id: true, name: true, description: true },
    });

    const assignments = await db.testCaseAssignment.findMany({
        where: { snapshotId },
        select: { testCase: { select: { folderId: true } } },
    });

    const counts = new Map<string, number>();
    for (const a of assignments) {
        counts.set(a.testCase.folderId, (counts.get(a.testCase.folderId) ?? 0) + 1);
    }

    return folders.map((f) => ({
        id: f.id,
        name: f.name,
        description: f.description ?? undefined,
        testCount: counts.get(f.id) ?? 0,
    }));
}
