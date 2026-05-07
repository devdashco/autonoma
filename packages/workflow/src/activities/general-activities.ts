/**
 * Activities executed on the "general" task queue.
 * Workers must export an object that `satisfies GeneralActivities` to ensure type safety.
 */

import type { GenerationVerdict, ReplayVerdict } from "@autonoma/types";

export interface ScenarioUpInput {
    scenarioJobType: string;
    entityId: string;
    scenarioId: string;
}

export interface ScenarioUpOutput {
    scenarioInstanceId: string;
}

export interface ScenarioDownInput {
    scenarioInstanceId: string;
}

export interface ReviewGenerationInput {
    generationId: string;
}

export interface ReviewGenerationOutput {
    status: "completed" | "failed" | "skipped";
    verdict?: GenerationVerdict;
}

export interface ReviewReplayInput {
    runId: string;
}

export interface ReviewReplayOutput {
    status: "completed" | "failed" | "skipped";
    verdict?: ReplayVerdict;
}

export interface CreateIssueFromGenerationReviewInput {
    generationId: string;
    verdict: GenerationVerdict;
    skipBugCreation?: boolean;
}

export interface CreateIssueFromRunReviewInput {
    runId: string;
    verdict: ReplayVerdict;
    skipBugCreation?: boolean;
}

export interface AssignGenerationResultsInput {
    generationIds: string[];
    autoActivate: boolean;
}

export interface NotifyGenerationExitInput {
    testGenerationId: string;
}

export interface MarkGenerationFailedInput {
    testGenerationId: string;
    reason?: string;
}

export interface MarkRunFailedInput {
    runId: string;
    reason?: string;
}

export interface GeneralActivities {
    scenarioUp(input: ScenarioUpInput): Promise<ScenarioUpOutput>;
    scenarioDown(input: ScenarioDownInput): Promise<void>;
    reviewGeneration(input: ReviewGenerationInput): Promise<ReviewGenerationOutput>;
    reviewReplay(input: ReviewReplayInput): Promise<ReviewReplayOutput>;
    createIssueFromGenerationReview(input: CreateIssueFromGenerationReviewInput): Promise<void>;
    createIssueFromRunReview(input: CreateIssueFromRunReviewInput): Promise<void>;
    assignGenerationResults(input: AssignGenerationResultsInput): Promise<void>;
    markGenerationFailed(input: MarkGenerationFailedInput): Promise<void>;
    markRunFailed(input: MarkRunFailedInput): Promise<void>;
    notifyGenerationExit(input: NotifyGenerationExitInput): Promise<void>;
}
