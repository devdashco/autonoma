import type { DiffsAgentResult } from "@autonoma/diffs";
import {
    type CheckFailure,
    baseFrontmatterSchema,
    checkIdentifierSet,
    identifierSetCheckSchema,
} from "@autonoma/evals";
import type { z } from "zod";

/**
 * Deterministic checks for an Analysis case, layered on the shared base.
 *
 * - `affected` grades the set of affected-test slugs (include / exclude / exact).
 *
 * The diffs agent now authors tests directly via `create_test` (no candidate
 * pre-gate). Grading the quality of those authored tests - dedup discipline,
 * coverage justification - is a substantive judge concern tracked in #1035, not
 * a count-bounds check here. Anything subtler (was the reasoning sound?) belongs
 * in the judge rubric, not here.
 */
export const analysisFrontmatterSchema = baseFrontmatterSchema.extend({
    affected: identifierSetCheckSchema.optional(),
});

export type AnalysisFrontmatter = z.infer<typeof analysisFrontmatterSchema>;

/** Apply the Analysis deterministic checks to an agent result. Empty list means all checks passed. */
export function checkAnalysisResult(result: DiffsAgentResult, frontmatter: AnalysisFrontmatter): CheckFailure[] {
    const failures: CheckFailure[] = [];

    if (frontmatter.affected != null) {
        const affectedSlugs = result.affectedTests.map((t) => t.slug);
        failures.push(...checkIdentifierSet("affected", affectedSlugs, frontmatter.affected));
    }

    return failures;
}
