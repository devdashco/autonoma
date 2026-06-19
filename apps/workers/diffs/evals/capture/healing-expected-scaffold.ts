/**
 * Build the scaffolded `expected.md` for a freshly captured Healing case
 * (`skip: true`, with the deterministic checks commented out for the author to
 * fill in). Shared by both the iteration-based capture and the snapshot-based
 * first-turn capture.
 *
 * `sourceLabel` describes where the case was captured from (e.g.
 * `iteration <id>` or `snapshot <id>`).
 */
export function buildHealingExpected(
    sourceLabel: string,
    failures: { testCaseId: string; testCaseSlug: string }[],
): string {
    const expectedLines = failures.map(
        (f) =>
            `#   ${f.testCaseId}: update_plan   # ${f.testCaseSlug} - pick: update_plan | report_bug | report_engine_limitation | remove_test`,
    );
    const expectedBlock =
        expectedLines.length > 0 ? expectedLines.join("\n") : "#   (no failing test cases in this turn)";

    return `---
description: "Captured from ${sourceLabel} - TODO: describe what this case exercises"
skip: true
# Deterministic check (uncomment + fill in, then set skip: false).
# One entry per failing test case in input.json; the keyset must match exactly,
# and each value is the action kind that test case should receive.
# expectedActions:
${expectedBlock}
---

TODO: author the LLM-judge rubric here.

The judge sees only the agent's structured output plus this body - never the
codebase or screenshots. Grade qualities the deterministic check cannot express:
  - For each \`update_plan\`: does the \`newPrompt\` address the cited failure?
    Is it specific enough? Does it preserve the test's original intent?
  - For each \`report_bug\` / \`report_engine_limitation\`: is the triage correct
    (application defect vs. engine/agent limitation)? Are the description and
    severity proportionate to the cited reasoning?
  - For each \`remove_test\`: is the cited reason plausible given the failure
    context (e.g. an invalid test born this snapshot, or a feature removed from
    the app)?
Keep every point additive to the frontmatter, and phrase each as something
checkable from the structured output alone.
`;
}
