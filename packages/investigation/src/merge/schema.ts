import { z } from "zod";

/**
 * One reconciliation decision for a single branch edit. `apply` carries the edit into main's suite (using
 * `mergedPlan` if the agent had to adapt it to main's current state, else the branch's proposed plan);
 * `skip` drops it (already covered, superseded, or in conflict) with the reason recorded for the report.
 */
export interface MergeDecision {
    /** The kind of branch edit this decision resolves. */
    kind: "new_test" | "modification";
    /** The existing test's slug (modification) or the proposed test's name (new_test) - matches the input edit. */
    ref: string;
    action: "apply" | "skip";
    /** Why this action - self-contained, so the report reads without cross-referencing. */
    reason: string;
    /**
     * The final plan to write when `action` is `apply`, set only when the branch's proposed plan had to be
     * ADAPTED to main's current state (a conflicting change others merged). Absent to apply the proposed plan
     * verbatim, and always absent for `skip`.
     */
    mergedPlan?: string;
}

/** The reconciler's output: one decision per branch edit, in the same order they were presented. */
export interface MergePlan {
    decisions: MergeDecision[];
}

/**
 * The schema the MODEL produces. `mergedPlan` is NULLABLE-and-required rather than optional because OpenAI's
 * strict structured-output mode requires every property to appear in `required` (an optional key is rejected).
 * `toMergePlan` normalizes the null back to `undefined` for the public shape.
 */
export const MergePlanForModel = z.object({
    decisions: z.array(
        z.object({
            kind: z.enum(["new_test", "modification"]),
            ref: z.string(),
            action: z.enum(["apply", "skip"]),
            reason: z.string(),
            mergedPlan: z.string().nullable(),
        }),
    ),
});

/** Normalize the model output (nullable mergedPlan) into the public MergePlan (undefined for absent). */
export function toMergePlan(output: z.infer<typeof MergePlanForModel>): MergePlan {
    return {
        decisions: output.decisions.map((decision) => ({
            kind: decision.kind,
            ref: decision.ref,
            action: decision.action,
            reason: decision.reason,
            mergedPlan: decision.mergedPlan ?? undefined,
        })),
    };
}
