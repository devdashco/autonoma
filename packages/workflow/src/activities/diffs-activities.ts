import type { WorkflowArchitecture } from "../types";

export interface AnalyzeDiffsInput {
    snapshotId: string;
}

export interface PreparedRunInfo {
    runId: string;
    slug: string;
    architecture: WorkflowArchitecture;
    scenarioId?: string;
}

export interface AnalyzeDiffsOutput {
    replays: PreparedRunInfo[];
}

export interface ResolveDiffsInput {
    snapshotId: string;
}

export interface FinalizeDiffsInput {
    snapshotId: string;
    /** When provided, the DiffsJob is marked failed with this reason instead of completed. */
    failureReason?: string;
}

export interface DiffsActivities {
    analyzeDiffs(input: AnalyzeDiffsInput): Promise<AnalyzeDiffsOutput>;
    resolveDiffs(input: ResolveDiffsInput): Promise<void>;
    finalizeDiffs(input: FinalizeDiffsInput): Promise<void>;
}
