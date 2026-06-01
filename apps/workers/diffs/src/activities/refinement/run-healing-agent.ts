import { logger as rootLogger } from "@autonoma/logger";
import type {
    RunHealingAgentForRefinementInput,
    RunHealingAgentForRefinementOutput,
} from "@autonoma/workflow/activities";
import { Context } from "@temporalio/activity";
import { withCodebaseForSnapshot } from "../../codebase/resolve";
import { runRefinementHealing } from "../../refinement/run-healing";

/**
 * Thin refinement-mode HealingAgent activity. Heartbeats, acquires the
 * snapshot's codebase, and delegates all orchestration to {@link runRefinementHealing},
 * which runs the agent inside the codebase closure and persists its actions.
 */
export async function runHealingAgentForRefinement(
    input: RunHealingAgentForRefinementInput,
): Promise<RunHealingAgentForRefinementOutput> {
    const logger = rootLogger.child({ name: "runHealingAgentForRefinement" });
    logger.info("Starting refinement healing run", { extra: { iterationNumber: input.iteration } });

    const heartbeat = setInterval(() => Context.current().heartbeat(), 30_000);

    try {
        const output = await withCodebaseForSnapshot(input.snapshotId, {
            targetDirSeed: `healing-${input.iterationId}`,
            body: (codebase) => runRefinementHealing(input, codebase),
        });
        logger.info("Refinement healing run completed", {
            extra: { actionCount: output.persistedActions.length },
        });
        return output;
    } finally {
        clearInterval(heartbeat);
    }
}
