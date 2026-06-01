import { type PrismaClient, db } from "@autonoma/db";
import {
    type Codebase,
    HealingAgent,
    type FailureRecord,
    type FlowSummary,
    type HealingAction,
    type HealingReviewLink,
    type PlanAuthoringInput,
    ScenarioIndex,
    healingActionSchema,
    openModelSession,
    summarizeSessionCost,
} from "@autonoma/diffs";
import { logger as rootLogger } from "@autonoma/logger";
import { S3Storage } from "@autonoma/storage";
import { TestSuiteUpdater } from "@autonoma/test-updates";
import type {
    PersistedHealingAction,
    RunHealingAgentForRefinementInput,
    RunHealingAgentForRefinementOutput,
} from "@autonoma/workflow/activities";
import { uploadHealingConversation } from "./upload-conversation";

/**
 * Orchestrates a single refinement-mode HealingAgent run inside a codebase
 * already acquired by the activity. Opens a model session, loads prior actions
 * / plan-authoring input / failure records, runs the agent, persists each
 * emitted action as a RefinementAction row, uploads the conversation, and logs
 * aggregated cost. Returns the persisted rows so the workflow can dispatch
 * apply* activities.
 */
export async function runRefinementHealing(
    input: RunHealingAgentForRefinementInput,
    codebase: Codebase,
): Promise<RunHealingAgentForRefinementOutput> {
    const logger = rootLogger.child({ name: "runRefinementHealing" });
    logger.info("Running refinement healing agent", {
        extra: {
            iterationNumber: input.iteration,
            failureCount: input.failuresAtGeneration.length + input.failuresAtReplay.length,
        },
    });

    const updater = await TestSuiteUpdater.continueUpdateBySnapshot({
        db,
        snapshotId: input.snapshotId,
        organizationId: input.organizationId,
    });

    const priorActions = await loadPriorActions(input.iterationId);
    const failures = collectFailureRecords(input);
    const reportableReviewLinks = computeReportableReviewLinks(input);
    const planAuthoring = await loadPlanAuthoringInput({
        db,
        applicationId: updater.applicationId,
        snapshotId: input.snapshotId,
    });

    const session = openModelSession();
    const model = session.getModel({ model: "smart-visual", tag: "healing-refinement" });

    const agent = new HealingAgent({ model });
    const { result, conversation } = await agent.run({
        iteration: input.iteration,
        priorActions,
        failures,
        reportableReviewLinks,
        codebase,
        planAuthoring,
        snapshotId: input.snapshotId,
        applicationId: updater.applicationId,
        organizationId: input.organizationId,
    });

    const persisted = await persistActions(input.iterationId, result.actions);

    const conversationUrl = await uploadHealingConversation({
        storage: S3Storage.createFromEnv(),
        iterationId: input.iterationId,
        conversation,
        logger: logger.child({ name: "uploadHealingConversation" }),
    });
    if (conversationUrl != null) {
        await db.refinementIteration.update({
            where: { id: input.iterationId },
            data: { healingConversationUrl: conversationUrl },
        });
    }

    logger.info("Refinement healing cost", { extra: summarizeSessionCost(session.costCollector) });

    logger.info("Refinement healing run finished", { extra: { actionCount: persisted.length } });

    return { persistedActions: persisted, reasoning: result.reasoning };
}

async function loadPriorActions(currentIterationId: string): Promise<HealingAction[]> {
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
function computeReportableReviewLinks(input: RunHealingAgentForRefinementInput): Map<string, HealingReviewLink> {
    const reviewLinks = new Map<string, HealingReviewLink>();
    for (const f of input.failuresAtGeneration) {
        if (f.generationReviewId != null && !reviewLinks.has(f.testCaseId)) {
            reviewLinks.set(f.testCaseId, { generationReviewId: f.generationReviewId });
        }
    }
    for (const f of input.failuresAtReplay) {
        if (f.runReviewId != null && !reviewLinks.has(f.testCaseId)) {
            reviewLinks.set(f.testCaseId, { runReviewId: f.runReviewId });
        }
    }
    return reviewLinks;
}

function collectFailureRecords(input: RunHealingAgentForRefinementInput): FailureRecord[] {
    const fromGen: FailureRecord[] = input.failuresAtGeneration.map((f) => ({
        key: f.failureKey,
        source: "generation" as const,
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
    const fromRun: FailureRecord[] = input.failuresAtReplay.map((f) => ({
        key: f.failureKey,
        source: "replay" as const,
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

async function persistActions(iterationId: string, actions: HealingAction[]): Promise<PersistedHealingAction[]> {
    const persisted: PersistedHealingAction[] = [];

    for (const action of actions) {
        const row = await db.refinementAction.create({
            data: {
                iterationId,
                kind: action.kind,
                planId: actionPlanId(action),
                testCaseId: action.testCaseId,
                payload: actionPayload(action),
                reasoning: actionReasoning(action),
            },
            select: { id: true },
        });

        persisted.push({ refinementActionId: row.id, action });
    }

    return persisted;
}

function actionPlanId(a: HealingAction): string | undefined {
    return a.kind === "update_plan" ? a.planId : undefined;
}

function actionReasoning(a: HealingAction): string {
    return a.kind === "remove_test" ? a.reason : a.reasoning;
}

function actionPayload(a: HealingAction): Record<string, unknown> {
    const { kind: _kind, ...rest } = a;
    return rest as unknown as Record<string, unknown>;
}

async function loadPlanAuthoringInput({
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
