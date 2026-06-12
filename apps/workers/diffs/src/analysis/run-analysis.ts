import { createBillingService } from "@autonoma/billing";
import { db } from "@autonoma/db";
import type { AffectedTest, Codebase } from "@autonoma/diffs";
import { type AffectedTestSpec, prepareRuns } from "@autonoma/diffs/prepare-runs";
import { logger } from "@autonoma/logger";
import { S3Storage } from "@autonoma/storage";
import type { PreparedRunInfo } from "@autonoma/workflow/activities";
import { uploadConversation } from "../upload-conversation";
import { assembleDiffsAgentInput } from "./assemble-input";
import { runDiffsAgent } from "./run-diffs-agent";

export interface RunDiffsAnalysisParams {
    snapshotId: string;
    /** The on-disk clone (at base + head SHAs), acquired by the activity via `withCodebaseForSnapshot`. */
    codebase: Codebase;
}

export interface DiffsAnalysisResult {
    /** Runs prepared for replay - one per affected test that resolved to a runnable assignment. */
    replays: PreparedRunInfo[];
    /** The agent's analysis reasoning, persisted by the activity onto the DiffsJob. */
    reasoning: string;
    /** S3 URL of the persisted analysis conversation, or undefined if upload was skipped/failed. */
    conversationUrl?: string;
}

/**
 * Analysis runner: runs the merge flow + DiffsAgent against the provided
 * codebase clone, then applies the result (persists test candidates and
 * prepares replay runs). Returns the reasoning + conversation URL for the
 * activity to record on the DiffsJob.
 */
export async function runDiffsAnalysis({ snapshotId, codebase }: RunDiffsAnalysisParams): Promise<DiffsAnalysisResult> {
    logger.info("Starting diffs analysis");

    const { agentInput, importedAffectedTests, branchData } = await assembleDiffsAgentInput({ snapshotId, codebase });

    const { result: agentResult, conversation } = await runDiffsAgent({ input: agentInput, codebase });

    const conversationUrl = await uploadConversation({
        storage: S3Storage.createFromEnv(),
        snapshotId,
        phase: "analysis",
        conversation,
        logger: logger.child({ name: "uploadConversation" }),
    });

    const combinedAffectedTests = combineAffectedTests(importedAffectedTests, agentResult.affectedTests);

    logger.info("Agent analysis complete, applying results", {
        extra: {
            agentAffectedTests: agentResult.affectedTests.length,
            importedAffectedTests: importedAffectedTests.length,
            combined: combinedAffectedTests.length,
            testCandidates: agentResult.testCandidates.length,
        },
    });

    await persistTestCandidates(snapshotId, branchData.organizationId, agentResult.testCandidates);

    const replays = await prepareReplays({
        snapshotId,
        applicationId: branchData.applicationId,
        organizationId: branchData.organizationId,
        affectedTests: combinedAffectedTests,
    });

    logger.info("Diffs analysis complete", {
        extra: { preparedRuns: replays.length, reasoning: agentResult.reasoning.slice(0, 200) },
    });

    return { replays, reasoning: agentResult.reasoning, conversationUrl };
}

/** Merge the deterministically-imported affected tests with the agent's, deduping by slug (imports win). */
function combineAffectedTests(imported: AffectedTest[], fromAgent: AffectedTest[]): AffectedTest[] {
    const bySlug = new Map(imported.map((t) => [t.slug, t] as const));
    for (const t of fromAgent) {
        if (!bySlug.has(t.slug)) bySlug.set(t.slug, t);
    }
    return Array.from(bySlug.values());
}

async function persistTestCandidates(
    snapshotId: string,
    organizationId: string,
    candidates: { name: string; instruction: string; reasoning: string }[],
): Promise<void> {
    if (candidates.length === 0) return;

    await db.testCandidate.createMany({
        data: candidates.map((c) => ({
            snapshotId,
            organizationId,
            name: c.name,
            instruction: c.instruction,
            reasoning: c.reasoning,
        })),
    });
}

interface PrepareReplaysParams {
    snapshotId: string;
    applicationId: string;
    organizationId: string;
    affectedTests: AffectedTest[];
}

async function prepareReplays({
    snapshotId,
    applicationId,
    organizationId,
    affectedTests,
}: PrepareReplaysParams): Promise<PreparedRunInfo[]> {
    if (affectedTests.length === 0) return [];

    const billingService = createBillingService(db);
    const specs: AffectedTestSpec[] = affectedTests.map((t) => ({
        slug: t.slug,
        affectedReason: t.affectedReason,
        reasoning: t.reasoning,
    }));

    const runs = await prepareRuns(specs, {
        db,
        snapshotId,
        applicationId,
        organizationId,
        billingService,
    });

    return runs.map((r) => ({
        runId: r.runId,
        slug: r.slug,
        architecture: r.architecture,
        scenarioId: r.scenarioId,
    }));
}
