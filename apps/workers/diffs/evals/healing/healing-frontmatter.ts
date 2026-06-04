import type { HealingResult } from "@autonoma/diffs";
import { z } from "zod";
import { type CheckFailure, baseFrontmatterSchema } from "../framework/frontmatter";

const ACTION_KINDS = ["update_plan", "report_bug", "report_engine_limitation", "remove_test"] as const;

const actionKindSchema = z.enum(ACTION_KINDS);

/**
 * Per-testCaseId expectations. The healing runtime enforces a strict 1:1
 * mapping (every input failure must be handled by exactly one action, see
 * `healing-result-tool.ts:UnhandledFailuresError`), so the eval contract
 * mirrors that: each entry pins the expected action kind for a specific
 * failing test case, and the keyset must equal the set of test cases the
 * agent acted on.
 *
 * Anything subtler (was the rewritten plan sensible? was the bug severity
 * proportionate?) belongs in the judge rubric, not here.
 */
export const healingFrontmatterSchema = baseFrontmatterSchema.extend({
    expectedActions: z.record(z.string(), actionKindSchema).optional(),
});

export type HealingFrontmatter = z.infer<typeof healingFrontmatterSchema>;

/** Apply the Healing deterministic checks to an agent result. Empty list means all checks passed. */
export function checkHealingResult(result: HealingResult, frontmatter: HealingFrontmatter): CheckFailure[] {
    if (frontmatter.expectedActions == null) return [];

    const failures: CheckFailure[] = [];
    const expected = frontmatter.expectedActions;
    const expectedIds = new Set(Object.keys(expected));
    const emittedByTestCaseId = new Map(result.actions.map((a) => [a.testCaseId, a]));
    const emittedIds = new Set(emittedByTestCaseId.keys());

    // Coverage: every expected entry must have a matching emitted action with the right kind.
    for (const [testCaseId, expectedKind] of Object.entries(expected)) {
        const action = emittedByTestCaseId.get(testCaseId);
        if (action == null) {
            failures.push({
                check: `expectedActions.${testCaseId}`,
                message: `expected ${expectedKind} for ${testCaseId} but no action targeted this test case`,
            });
            continue;
        }
        if (action.kind !== expectedKind) {
            failures.push({
                check: `expectedActions.${testCaseId}`,
                message: `expected ${expectedKind} for ${testCaseId} but got ${action.kind}`,
            });
        }
    }

    // No extras: the agent must not act on test cases outside the expected set.
    // The healing runtime guarantees every input failure is handled, so the
    // emitted set should equal the expected set; surfacing both directions
    // makes drift loud.
    const unexpected = [...emittedIds].filter((id) => !expectedIds.has(id));
    if (unexpected.length > 0) {
        failures.push({
            check: "expectedActions.unexpected",
            message: `agent acted on test cases not listed in expectedActions: [${unexpected.join(", ")}]`,
        });
    }

    return failures;
}
