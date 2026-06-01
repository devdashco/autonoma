import { logger as rootLogger } from "@autonoma/logger";
import type {
    RunHealingAgentForRefinementInput,
    RunHealingAgentForRefinementOutput,
} from "@autonoma/workflow/activities";
import { Context } from "@temporalio/activity";
import { withCodebaseForSnapshot } from "../../codebase/resolve";
import { HealingRunner } from "./healing-runner";

/**
 * Thin refinement-mode HealingAgent activity. Heartbeats, acquires the
 * snapshot's codebase, and delegates all orchestration to {@link HealingRunner},
 * which runs the agent inside the codebase closure and persists its actions.
 */
export async function runHealingAgentForRefinement(
    input: RunHealingAgentForRefinementInput,
): Promise<RunHealingAgentForRefinementOutput> {
    const logger = rootLogger.child({ name: "runHealingAgentForRefinement" });
    logger.info("Starting refinement healing run", { extra: { iterationNumber: input.iteration } });

    const heartbeat = setInterval(() => Context.current().heartbeat(), 30_000);

    try {
        const runner = new HealingRunner(input);
        const output = await withCodebaseForSnapshot(input.snapshotId, {
            targetDirSeed: `healing-${input.iterationId}`,
            body: (codebase) => runner.run(codebase),
        });
        logger.info("Refinement healing run completed", {
            extra: { actionCount: output.persistedActions.length },
        });
        return output;
    } finally {
        clearInterval(heartbeat);
    }
}
