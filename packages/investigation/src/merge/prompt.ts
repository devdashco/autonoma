import type { BranchEdit, MainSuiteEntry } from "./merge-inputs";

export const MERGE_RECONCILER_SYSTEM_PROMPT = `You reconcile a feature branch's proposed E2E test edits into the main test suite AFTER the branch's PR has merged. Between the branch forking and merging, OTHER PRs may have merged their own test changes into main, so main has moved on. Your job: for each proposed edit, decide whether it still belongs in main as-is, needs adapting, or should be dropped.

You are given, for each edit:
- NEW TEST: a test the branch proposed for behavior it introduced, with its full plan.
- MODIFICATION: an existing test the branch revised, with three plans - BASE (the fork point), PROPOSED (the branch's revision), and MAIN NOW (what that same test looks like on main today, if it still exists).

And a summary of main's CURRENT suite (slug, flow, one-line description per test).

Decide per edit:
- apply: carry the edit into main. For a new test whose behavior no current main test already covers. For a modification when MAIN NOW still equals BASE (nobody else touched it) - apply the proposed plan verbatim.
- apply with a mergedPlan: only for a modification where MAIN NOW has DIVERGED from BASE (someone else changed the same test). Combine both intents into one plan that preserves the branch's fix AND the other change; never blindly clobber main's version. Keep it a minimal, surgical edit.
- skip: when a current main test already covers the new test's behavior (avoid duplicates); when the modification's target test no longer exists on main (it was deleted); or when main already applied an equivalent change and the proposed edit is now redundant. Always give the concrete reason.

Rules:
- Preserve the platform E2E plan guardrails already followed by the proposed plans: keep the Setup / Steps / Verification structure, the allowed verbs, and the existing wording/numbering. When you must merge, change only what conflicts.
- Prefer skip over creating near-duplicate coverage. A suite with two tests proving the same thing is worse than one.
- Be conservative: when unsure whether main already covers something, apply (the next investigation run self-heals a redundant test) - but SAY you were unsure in the reason.
- Output exactly one decision per input edit, in the same order, keyed by the edit's ref.`;

/** Render one branch edit as a labeled block for the reconciler prompt. */
export function renderEdit(edit: BranchEdit, index: number): string {
    const header = `### Edit ${index + 1} - ${edit.kind} - ref: ${edit.ref}\nname: ${edit.name}\nflow: ${edit.flow}`;
    if (edit.kind === "new_test") {
        return `${header}\n\nPROPOSED PLAN:\n${edit.proposedPlan}`;
    }
    const base = edit.basePlan ?? "(baseline plan unavailable)";
    const mainNow = edit.mainCurrentPlan ?? "(this test no longer exists on main)";
    return `${header}\n\nBASE (fork point):\n${base}\n\nPROPOSED (branch revision):\n${edit.proposedPlan}\n\nMAIN NOW:\n${mainNow}`;
}

/** Render main's current suite as a compact catalog so the reconciler can spot existing coverage. */
export function renderMainSuite(mainSuite: MainSuiteEntry[]): string {
    if (mainSuite.length === 0) return "(main has no tests)";
    return mainSuite.map((test) => `- [${test.flow}] ${test.slug}: ${test.description}`).join("\n");
}

export function buildMergePrompt(edits: BranchEdit[], mainSuite: MainSuiteEntry[]): string {
    const editBlocks = edits.map((edit, index) => renderEdit(edit, index)).join("\n\n---\n\n");
    return `MAIN'S CURRENT SUITE (${mainSuite.length} tests):\n${renderMainSuite(mainSuite)}\n\n---\n\nPROPOSED EDITS TO RECONCILE (${edits.length}):\n\n${editBlocks}`;
}
