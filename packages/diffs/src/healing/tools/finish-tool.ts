import { tool } from "ai";
import { z } from "zod";
import type { HealingActionCollector } from "./action-tools";

const finishSchema = z.object({
    reasoning: z
        .string()
        .describe(
            "One-paragraph summary of what you did: which patterns you found, which tests were updated/quarantined/removed, which bugs were reported, and why. Goes into the audit trail.",
        ),
});

export function buildFinishTool(
    collector: HealingActionCollector,
    failureKeys: Set<string>,
    onFinish: (result: { reasoning: string }) => void,
) {
    return tool({
        description:
            "Call this when you have addressed every failure. The call is rejected if any failure has not been handled by update_plan, report_bug, report_engine_limitation, or remove_test.",
        inputSchema: finishSchema,
        execute: ({ reasoning }) => {
            const unhandled = [...failureKeys].filter((k) => !collector.handledFailureKeys.has(k));
            if (unhandled.length > 0) {
                return {
                    error: `Failure(s) not handled: ${unhandled.join(", ")}. Each must be addressed by update_plan, report_bug, report_engine_limitation, or remove_test before finishing.`,
                };
            }
            onFinish({ reasoning });
            return { success: true };
        },
    });
}
