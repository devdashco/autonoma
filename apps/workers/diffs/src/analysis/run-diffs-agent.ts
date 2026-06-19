import type { AgentRunResult } from "@autonoma/ai";
import {
    type Codebase,
    DiffsAgent,
    type DiffsAgentInput,
    type DiffsAgentResult,
    openModelSession,
    summarizeSessionCost,
} from "@autonoma/diffs";
import { logger } from "@autonoma/logger";

interface RunDiffsAgentParams {
    /** Everything the DiffsAgent needs except the codebase clone (which the activity owns). */
    input: Omit<DiffsAgentInput, "codebase">;
    /** The on-disk clone, acquired by the activity via `withCodebaseForSnapshot`. */
    codebase: Codebase;
}

/**
 * Constructs a {@link DiffsAgent} over a metered {@link openModelSession} and
 * invokes {@link DiffsAgent.run}. After the run it logs an aggregated cost
 * summary drawn from the session's collector (no DB persistence).
 */
export async function runDiffsAgent({
    input,
    codebase,
}: RunDiffsAgentParams): Promise<AgentRunResult<DiffsAgentResult>> {
    const session = openModelSession();
    const model = session.getModel({ model: "smart-visual", tag: "diffs-analysis" });

    const agent = new DiffsAgent({ model });

    const { result, conversation } = await agent.run({ ...input, codebase });

    logger.info("Diffs analysis model cost", { extra: summarizeSessionCost(session.costCollector) });

    logger.info("Diffs analysis complete", {
        extra: {
            affectedTests: result.affectedTests.length,
            createdTests: result.createdTests.length,
            reasoning: result.reasoning.slice(0, 500),
        },
    });

    return { result, conversation };
}
