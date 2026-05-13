import type { FiredBatch, GenerationProvider, PendingGeneration } from "./generation-job-provider";

export class FakeGenerationProvider implements GenerationProvider {
    public readonly firedBatches: { snapshotId: string; generations: PendingGeneration[] }[] = [];

    async fireJobs(snapshotId: string, generations: PendingGeneration[]): Promise<FiredBatch> {
        this.firedBatches.push({ snapshotId, generations });

        return { batchWorkflowId: "", batchWorkflowRunId: "" };
    }
}
