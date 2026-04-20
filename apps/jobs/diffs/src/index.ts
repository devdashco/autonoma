import { logger } from "@autonoma/logger";
import { jobEnv } from "./job-env";
import { runDiffsAnalysis } from "./run";

logger.info("Starting diffs analysis job", { branchId: jobEnv.BRANCH_ID });

try {
    const result = await runDiffsAnalysis(jobEnv.BRANCH_ID);
    logger.info("Diffs analysis complete", {
        affectedTests: result.affectedTests.length,
        testCandidates: result.testCandidates.length,
        reasoning: result.reasoning.slice(0, 500),
    });
    process.exit(0);
} catch (error) {
    logger.error("Diffs analysis failed", error, { branchId: jobEnv.BRANCH_ID });
    process.exit(1);
}
