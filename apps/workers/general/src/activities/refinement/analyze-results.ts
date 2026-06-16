import { db } from "@autonoma/db";
import { bucketIterationOutcomes } from "@autonoma/diffs";
import { extendObservabilityContext, logger as rootLogger } from "@autonoma/logger";
import type { AnalyzeResultsInput, AnalyzeResultsOutput } from "@autonoma/workflow/activities";

/**
 * Reads the outcomes of every plan in a refinement iteration's input set and
 * buckets them. Thin activity wrapper around the shared
 * {@link bucketIterationOutcomes} helper (which is also used by the healing
 * eval-capture utility): this activity adds observability context and shapes
 * the result for the workflow's activity contract.
 */
export async function analyzeResults(input: AnalyzeResultsInput): Promise<AnalyzeResultsOutput> {
    const logger = rootLogger.child({ name: "analyzeResults" });
    logger.info("Analyzing iteration results");

    const outcomes = await bucketIterationOutcomes(db, input.iterationId, logger);

    extendObservabilityContext({
        snapshot: { snapshotId: outcomes.snapshotId },
        refinementLoop: { loopId: outcomes.loopId, triggeredBy: outcomes.triggeredBy },
        refinementIteration: { iterationId: input.iterationId, iterationNumber: outcomes.iterationNumber },
    });

    return {
        validatedTestCaseIds: outcomes.validatedTestCaseIds,
        failuresAtGeneration: outcomes.failuresAtGeneration,
        failuresAtReplay: outcomes.failuresAtReplay,
    };
}
