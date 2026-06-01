import type { PrismaClient } from "@autonoma/db";
import {
    type Codebase,
    type FlowIndex,
    ResolutionAgent,
    type ResolutionAgentInput,
    type ResolutionAgentResult,
    ScenarioIndex,
    type ScenarioInfo,
    createResolutionCallbacks,
    openModelSession,
    summarizeSessionCost,
} from "@autonoma/diffs";
import { logger } from "@autonoma/logger";
import type { TestSuiteUpdater } from "@autonoma/test-updates";
import type { ModelMessage } from "ai";

export interface RunResolutionAgentParams {
    /** Everything the ResolutionAgent needs except the codebase clone and scenario index, which the runner builds. */
    input: Omit<ResolutionAgentInput, "codebase" | "scenarioIndex" | "flowIndex">;
    db: PrismaClient;
    updater: TestSuiteUpdater;
    /** The on-disk clone (at base + head SHAs), acquired by the activity via `withCodebaseForSnapshot`. */
    codebase: Codebase;
    flowIndex: FlowIndex;
}

export interface AcceptedCandidateLink {
    candidateId: string;
    testCaseId: string;
}

export interface RunResolutionAgentResult extends ResolutionAgentResult {
    accepted: AcceptedCandidateLink[];
    conversation: ModelMessage[];
}

/**
 * Constructs a {@link ResolutionAgent} over a metered {@link openModelSession},
 * runs it against the provided codebase clone, and applies the result by
 * dispatching its modify / remove / report-bug / add-test callbacks. After the
 * run it logs an aggregated cost summary drawn from the session's collector (no
 * DB persistence).
 */
export async function runResolutionAgent({
    input,
    db,
    updater,
    codebase,
    flowIndex,
}: RunResolutionAgentParams): Promise<RunResolutionAgentResult> {
    const session = openModelSession();
    const model = session.getModel({ model: "smart-visual", tag: "diffs-resolution" });

    const scenarioIndex = await loadScenarioIndex(db, updater.applicationId);

    const agent = new ResolutionAgent({ model });

    const { result, conversation } = await agent.run({ ...input, codebase, flowIndex, scenarioIndex });

    const callbacks = createResolutionCallbacks({ db, updater });

    const accepted: AcceptedCandidateLink[] = [];

    await Promise.all([
        ...result.modifiedTests.map((t) => callbacks.modifyTest(t.slug, t.newInstruction)),
        ...result.removedTests.map((t) => callbacks.removeTest(t.slug)),
        ...result.reportedBugs.map((b) => callbacks.reportBug(b)),
        ...result.newTests.map(async (t) => {
            const folder = flowIndex.getFlow(t.folderName);
            if (folder == null) throw new Error(`Folder "${t.folderName}" not found for new test "${t.name}"`);
            const { testCaseId } = await callbacks.addTest({ ...t, folderId: folder.id });
            if (t.acceptingCandidateId != null) {
                accepted.push({ candidateId: t.acceptingCandidateId, testCaseId });
            }
        }),
    ]);

    logger.info("Resolution agent cost", { extra: summarizeSessionCost(session.costCollector) });

    logger.info("Resolution agent complete", {
        extra: {
            modifiedTests: result.modifiedTests.length,
            removedTests: result.removedTests.length,
            reportedBugs: result.reportedBugs.length,
            newTests: result.newTests.length,
            acceptedCandidates: accepted.length,
            reasoning: result.reasoning.slice(0, 500),
        },
    });

    return { ...result, accepted, conversation };
}

async function loadScenarioIndex(db: PrismaClient, applicationId: string): Promise<ScenarioIndex> {
    logger.info("Loading scenarios for resolution agent", { extra: { applicationId } });

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

    const infos: ScenarioInfo[] = scenarios.map((s) => {
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

    logger.info("Loaded scenarios", { extra: { count: infos.length } });
    return new ScenarioIndex(infos);
}
