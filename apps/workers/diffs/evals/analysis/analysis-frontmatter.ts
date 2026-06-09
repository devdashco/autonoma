import type { DiffsAgentResult } from "@autonoma/diffs";
import {
    type CheckFailure,
    baseFrontmatterSchema,
    checkCountBounds,
    checkIdentifierSet,
    countBoundsSchema,
    identifierSetCheckSchema,
} from "@autonoma/evals";
import type { z } from "zod";

/**
 * Deterministic checks for an Analysis case, layered on the shared base.
 *
 * - `affected` grades the set of affected-test slugs (include / exclude / exact).
 * - `candidates` bounds how many new-test candidates the agent suggested.
 *
 * Anything subtler (was the reasoning sound? is the candidate sensible?) belongs
 * in the judge rubric, not here.
 */
export const analysisFrontmatterSchema = baseFrontmatterSchema.extend({
    affected: identifierSetCheckSchema.optional(),
    candidates: countBoundsSchema.optional(),
});

export type AnalysisFrontmatter = z.infer<typeof analysisFrontmatterSchema>;

/** Apply the Analysis deterministic checks to an agent result. Empty list means all checks passed. */
export function checkAnalysisResult(result: DiffsAgentResult, frontmatter: AnalysisFrontmatter): CheckFailure[] {
    const failures: CheckFailure[] = [];

    if (frontmatter.affected != null) {
        const affectedSlugs = result.affectedTests.map((t) => t.slug);
        failures.push(...checkIdentifierSet("affected", affectedSlugs, frontmatter.affected));
    }

    if (frontmatter.candidates != null) {
        failures.push(...checkCountBounds("candidates", result.testCandidates.length, frontmatter.candidates));
    }

    return failures;
}
