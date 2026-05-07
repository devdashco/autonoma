import { logger } from "@autonoma/logger";

interface AgentStepLike {
    readonly toolCalls: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Walks the agent's step trace looking for the named verdict tool call.
 * Returns the input it was called with, cast to T. The caller is responsible
 * for the cast — this function is intentionally generic.
 */
export function extractVerdict<T>(steps: ReadonlyArray<AgentStepLike>, toolName = "submit_verdict"): T | undefined {
    for (const step of steps) {
        for (const toolCall of step.toolCalls) {
            if (toolCall.toolName === toolName) {
                return toolCall.input as T;
            }
        }
    }

    logger.warn("No verdict tool call found - agent reached max steps without submitting", { toolName });

    return undefined;
}
