import { type Logger, logger } from "@autonoma/logger";
import { triggerBatchGeneration } from "@autonoma/workflow";
import type { FiredBatch, GenerationProvider, PendingGeneration } from "./generation-job-provider";

export class TemporalGenerationProvider implements GenerationProvider {
    private readonly logger: Logger;

    constructor() {
        this.logger = logger.child({ name: this.constructor.name });
    }

    async fireJobs(snapshotId: string, generations: PendingGeneration[]): Promise<FiredBatch> {
        const firstGeneration = generations[0];
        if (firstGeneration == null) {
            return { batchWorkflowId: "", batchWorkflowRunId: "" };
        }

        const architecture = firstGeneration.architecture;
        const testGenerationIds = generations.map((g) => g.testGenerationId);
        this.logger.info("Firing batch generation workflow", { snapshotId, testGenerationIds, architecture });

        const triggerResult = (await triggerBatchGeneration({
            snapshotId,
            testPlans: generations.map((g) => ({
                testGenerationId: g.testGenerationId,
                scenarioId: g.scenarioId,
            })),
            architecture,
        })) as { workflowId?: string; runId?: string } | void;

        const workflowId = typeof triggerResult?.workflowId === "string" ? triggerResult.workflowId : "";
        const runId = typeof triggerResult?.runId === "string" ? triggerResult.runId : "";

        this.logger.info("Batch generation workflow fired", { testGenerationIds, workflowId });

        return { batchWorkflowId: workflowId, batchWorkflowRunId: runId };
    }
}
