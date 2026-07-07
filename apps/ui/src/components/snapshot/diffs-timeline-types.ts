import type { RouterOutputs } from "lib/trpc";

export type SnapshotDetail = RouterOutputs["branches"]["snapshotDetail"];
export type DiffsJob = NonNullable<SnapshotDetail["diffsJob"]>;
export type DiffsJobStatus = DiffsJob["status"];
export type AffectedTest = DiffsJob["affectedTests"][number];
export type CreatedTest = SnapshotDetail["createdTests"][number];
export type SnapshotChange = SnapshotDetail["changes"][number];
export type ExecutedTest = SnapshotDetail["executedTests"][number];

export const STAGE_KEYS = ["analysis", "generation", "finalization"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export type StageStatus = "upcoming" | "current" | "done" | "failed";

const ACTIVE_STAGE_OF_STATUS: Partial<Record<DiffsJobStatus, StageKey>> = {
    analyzing: "analysis",
    // `replaying` is a legacy status: the pipeline no longer replays, but historical
    // jobs may still carry it - surface them at the generation stage.
    replaying: "generation",
    generating: "generation",
    finalizing: "finalization",
};

function stageEvidence(stage: StageKey, job: DiffsJob): boolean {
    switch (stage) {
        case "analysis":
            return job.analysisReasoning != null || job.affectedTests.length > 0;
        case "generation":
            return job.affectedTests.some((t) => t.generation != null);
        case "finalization":
            return false;
    }
}

export function computeStageStatuses(job: DiffsJob): Record<StageKey, StageStatus> {
    if (job.status === "completed") {
        return {
            analysis: "done",
            generation: "done",
            finalization: "done",
        };
    }

    if (job.status === "pending") {
        return {
            analysis: "upcoming",
            generation: "upcoming",
            finalization: "upcoming",
        };
    }

    if (job.status === "failed") {
        let failedStage: StageKey = "analysis";
        for (const key of STAGE_KEYS) {
            if (stageEvidence(key, job)) failedStage = key;
        }

        const failedIndex = STAGE_KEYS.indexOf(failedStage);
        const result = {} as Record<StageKey, StageStatus>;
        STAGE_KEYS.forEach((key, idx) => {
            if (idx < failedIndex) result[key] = "done";
            else if (idx === failedIndex) result[key] = "failed";
            else result[key] = "upcoming";
        });
        return result;
    }

    const currentStage = ACTIVE_STAGE_OF_STATUS[job.status] ?? "analysis";
    const currentIndex = STAGE_KEYS.indexOf(currentStage);
    const result = {} as Record<StageKey, StageStatus>;
    STAGE_KEYS.forEach((key, idx) => {
        if (idx < currentIndex) result[key] = "done";
        else if (idx === currentIndex) result[key] = "current";
        else result[key] = "upcoming";
    });
    return result;
}
