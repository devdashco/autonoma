import { AgentTool } from "@autonoma/ai";
import type { z } from "zod";
import { removeTestInputSchema } from "../../../healing/actions";
import type { HealingAgentLoop } from "../healing-agent-loop";
import { recordHealingAction, resolveReviewLink } from "./record-action";

export type HealingRemoveTestInput = z.infer<typeof removeTestInputSchema>;

interface RemoveTestOutput {
    testCaseId: string;
}

/**
 * Action tool: permanently remove an invalid test (or one whose feature was
 * deleted) from the suite. Like the report tools, the runner attaches the
 * source review link from the failure that surfaced the problem; the model
 * cannot author it, and a test case with no source review is rejected at the
 * boundary so removal is always failure-driven and citable.
 */
export class HealingRemoveTestTool extends AgentTool<HealingRemoveTestInput, RemoveTestOutput, HealingAgentLoop> {
    constructor() {
        super({
            name: "remove_test",
            description:
                "Permanently remove a test from the suite (suite-level delete, not a per-snapshot quarantine). Use only for an invalid test (not a viable flow, never useful without becoming a different test) or one whose feature was deleted from the app. A pre-existing test that merely fails is useful - quarantine it via report_bug / report_engine_limitation / update_plan instead. Requires a cited failure: the call is rejected if the test case has no source review.",
            inputSchema: removeTestInputSchema,
        });
    }

    protected async execute(input: HealingRemoveTestInput, loop: HealingAgentLoop): Promise<RemoveTestOutput> {
        const reviewLink = resolveReviewLink(loop, input.testCaseId);
        recordHealingAction(loop, { kind: "remove_test", ...input, reviewLink });
        return { testCaseId: input.testCaseId };
    }
}
