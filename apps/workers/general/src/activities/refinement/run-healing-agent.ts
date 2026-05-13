import { MODEL_ENTRIES, ModelRegistry } from "@autonoma/ai";
import { db } from "@autonoma/db";
import { HealingAgent, type FailureRecord, type HealingAction, healingActionSchema } from "@autonoma/healing";
import { logger as rootLogger } from "@autonoma/logger";
import { S3Storage } from "@autonoma/storage";
import { TestSuiteUpdater } from "@autonoma/test-updates";
import type {
    PersistedHealingAction,
    RunHealingAgentForRefinementInput,
    RunHealingAgentForRefinementOutput,
} from "@autonoma/workflow/activities";
import { Context } from "@temporalio/activity";
import { withCodebaseForSnapshot } from "../../codebase/resolve";
import { uploadHealingConversation } from "./upload-conversation";

/**
 * Refinement-mode runner for HealingAgent. Clones the snapshot's codebase,
 * loads prior actions for this loop, runs the agent, persists each emitted
 * action as a RefinementAction row, and returns the persisted rows so the
 * workflow can dispatch apply* activities.
 */
export async function runHealingAgentForRefinement(
    input: RunHealingAgentForRefinementInput,
): Promise<RunHealingAgentForRefinementOutput> {
    const logger = rootLogger.child({
        name: "runHealingAgentForRefinement",
        snapshotId: input.snapshotId,
        iterationId: input.iterationId,
        iteration: input.iteration,
    });
    logger.info("Starting refinement healing run", {
        failureCount: input.failuresAtGeneration.length + input.failuresAtReplay.length,
    });

    const heartbeat = setInterval(() => Context.current().heartbeat(), 30_000);

    try {
        const updater = await TestSuiteUpdater.continueUpdateBySnapshot({
            db,
            snapshotId: input.snapshotId,
            organizationId: input.organizationId,
        });

        const priorActions = await loadPriorActions(input.iterationId);

        const failures = collectFailureRecords(input);

        const registry = new ModelRegistry({
            models: { flash: MODEL_ENTRIES.GEMINI_3_FLASH_PREVIEW },
        });
        const model = registry.getModel({ model: "flash", tag: "healing-refinement" });

        const result = await withCodebaseForSnapshot(input.snapshotId, {
            targetDirSeed: `healing-${input.iterationId}`,
            body: async (codebase) => {
                const agent = new HealingAgent({ model, db });
                return await agent.heal({
                    mode: "refinement",
                    iteration: input.iteration,
                    priorActions,
                    failures,
                    codebase,
                    snapshotId: input.snapshotId,
                    applicationId: updater.applicationId,
                    organizationId: input.organizationId,
                });
            },
        });

        const persisted = await persistActions(input.iterationId, result.actions, input);

        const conversationUrl = await uploadHealingConversation({
            storage: S3Storage.createFromEnv(),
            iterationId: input.iterationId,
            conversation: result.conversation,
            logger: logger.child({ name: "uploadHealingConversation", iterationId: input.iterationId }),
        });
        if (conversationUrl != null) {
            await db.refinementIteration.update({
                where: { id: input.iterationId },
                data: { healingConversationUrl: conversationUrl },
            });
        }

        logger.info("Refinement healing run finished", {
            actionCount: persisted.length,
            modelUsage: registry.modelUsage,
        });

        return { persistedActions: persisted, reasoning: result.reasoning };
    } finally {
        clearInterval(heartbeat);
    }
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

async function persistActions(
    iterationId: string,
    actions: HealingAction[],
    input: RunHealingAgentForRefinementInput,
): Promise<PersistedHealingAction[]> {
    const persisted: PersistedHealingAction[] = [];

    for (const action of actions) {
        const reviewLink =
            action.kind === "report_bug" || action.kind === "report_engine_limitation"
                ? findReviewLinkFor(action.testCaseId, input)
                : undefined;

        const decorated = decorateActionWithReviewLink(action, reviewLink);

        const row = await db.refinementAction.create({
            data: {
                iterationId,
                kind: decorated.kind,
                planId: actionPlanId(decorated),
                testCaseId: actionTestCaseId(decorated),
                payload: actionPayload(decorated),
                reasoning: actionReasoning(decorated),
            },
            select: { id: true },
        });

        persisted.push({
            refinementActionId: row.id,
            action: decorated,
        });
    }

    return persisted;
}

function findReviewLinkFor(
    testCaseId: string,
    input: RunHealingAgentForRefinementInput,
): { generationReviewId: string } | { runReviewId: string } | undefined {
    const fromGen = input.failuresAtGeneration.find((f) => f.testCaseId === testCaseId);
    if (fromGen?.generationReviewId != null) return { generationReviewId: fromGen.generationReviewId };
    const fromRun = input.failuresAtReplay.find((f) => f.testCaseId === testCaseId);
    if (fromRun?.runReviewId != null) return { runReviewId: fromRun.runReviewId };
    return undefined;
}

type DecoratedAction = PersistedHealingAction["action"];

function decorateActionWithReviewLink(
    action: HealingAction,
    reviewLink: { generationReviewId: string } | { runReviewId: string } | undefined,
): DecoratedAction {
    if (action.kind === "report_bug") {
        if (reviewLink == null) {
            throw new Error(`report_bug for testCaseId=${action.testCaseId} has no source review to link`);
        }
        return { ...action, reviewLink };
    }
    if (action.kind === "report_engine_limitation") {
        if (reviewLink == null) {
            throw new Error(
                `report_engine_limitation for testCaseId=${action.testCaseId} has no source review to link`,
            );
        }
        return { ...action, reviewLink };
    }
    return action;
}

function actionPlanId(a: DecoratedAction): string | undefined {
    return a.kind === "update_plan" ? a.planId : undefined;
}

function actionTestCaseId(a: DecoratedAction): string | undefined {
    if (a.kind === "add_test") return undefined;
    return a.testCaseId;
}

function actionReasoning(a: DecoratedAction): string {
    return a.kind === "remove_test" ? a.reason : a.reasoning;
}

function actionPayload(a: DecoratedAction): Record<string, unknown> {
    const { kind: _kind, ...rest } = a;
    return rest as unknown as Record<string, unknown>;
}
