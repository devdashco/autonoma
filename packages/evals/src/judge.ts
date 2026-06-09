import { z } from "zod";

export const judgeVerdictSchema = z.object({
    /** Whether the agent output conforms to the rubric. */
    passed: z.boolean(),
    /** Short justification, citing the specific rubric points that did or did not hold. */
    reasoning: z.string(),
});

export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

export interface JudgeResult extends JudgeVerdict {
    /** Cost of this single judge call, metered into the judge's own session collector. */
    cost: unknown;
}

export interface JudgeParams {
    /** The step's structured agent output (serialized to JSON for the judge). */
    output: unknown;
    /** The authored rubric (the `expected.md` body) - the ground truth the judge grades against. */
    rubric: string;
}
