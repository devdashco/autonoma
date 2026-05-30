import { z } from "zod";

export const bugVerdictSchema = z.enum(["true_positive", "false_positive"]);
export type BugVerdict = z.infer<typeof bugVerdictSchema>;
