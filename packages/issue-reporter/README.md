# @autonoma/issue-reporter

**Transitional adapter.** Writes `Issue` rows (and optionally links `Bug` rows) in response to reviewer verdicts and other ad-hoc bug-discovery events. Will be replaced by the upcoming `PlanActionAgent` - **delete this package when the action agent ships.**

## Why this exists

The reviewer rewrite intentionally pulled Issue/Bug creation **out** of the reviewer's responsibility - reviewers now produce verdicts only. To preserve current downstream behavior (Issues page, Bug deduplication) without waiting for the action agent, this package owns the full DB-write side of the legacy bug pipeline.

## Public API

One class, one collaborator.

```ts
import { IssueReporter } from "@autonoma/issue-reporter";

const reporter = IssueReporter.fromModel(model); // builds an internal BugMatcher
// or:
const reporter = new IssueReporter(new BugMatcher(model));
```

| Method | Caller | What it does |
|--------|--------|--------------|
| `reportFromGenerationVerdict(params)` | `createIssueFromGenerationReview` worker activity | Map the 4-outcome generation verdict to an `IssueCategory`, write the `Issue` row, and link a `Bug` if confidence >= 70 and not skipped. |
| `reportFromRunVerdict(params)` | `createIssueFromRunReview` worker activity | Same shape for the binary replay verdict. |
| `recordBugFromRunReview(tx, params)` | Diffs resolution agent (`packages/diffs/src/callbacks/report-bug.ts`) | Creates a high-confidence Issue + links a Bug atomically from a manually-determined bug report (not a verdict). |
| `promoteIssueToBug(tx, params)` | API "confirm as bug" UI flow (`apps/api/src/routes/bugs/bugs.service.ts`) | Given an existing Issue, find a matching Bug or create a new one and link the Issue to it. Also escalates the Bug's severity / flips `resolved` -> `regressed` if applicable. |

## Verdict mapping table

| GenerationReview verdict | Action | IssueCategory |
|--------------------------|--------|---------------|
| `success` | (skip - no Issue created) | n/a |
| `agent_limitation` | create Issue | `agent_error` |
| `application_bug` | create Issue, link/create Bug if confidence >= 70 | `application_bug` |
| `plan_mismatch` | create Issue | `agent_error` |

| RunReview verdict | Action | IssueCategory |
|-------------------|--------|---------------|
| `engine_error` | create Issue | `agent_error` |
| `application_bug` | create Issue, link/create Bug if confidence >= 70 | `application_bug` |

## Usage

```ts
import { IssueReporter } from "@autonoma/issue-reporter";

const reporter = IssueReporter.fromModel(model);

await reporter.reportFromGenerationVerdict({
    generationReviewId,
    verdict, // GenerationVerdict from the reviewer
    organizationId,
    skipBugCreation: input.skipIssueBugCreation,
    resolveLinkContext: async () => {
        const generation = await db.testGeneration.findUniqueOrThrow({
            where: { id: generationId },
            select: {
                snapshot: { select: { branchId: true } },
                testPlan: { select: { testCaseId: true } },
            },
        });
        return {
            branchId: generation.snapshot.branchId,
            testCaseId: generation.testPlan.testCaseId,
        };
    },
});
```

## Architecture Notes

- **Lazy link context.** `resolveLinkContext` is only awaited when the Issue actually qualifies for Bug linking (high-confidence `application_bug`). Avoids one DB hop on every review.
- **Postgres advisory locking.** `promoteIssueToBug` uses `SELECT ... FOR UPDATE` on the candidate Bug rows to prevent concurrent reviewers from creating duplicate Bugs.
- **Severity escalation.** When linking to an existing Bug, severity is raised to the higher of the two; resolved Bugs flip to `regressed`.
- **Skipping is honored.** The `skipBugCreation` flag (used by diff-triggered child workflows) suppresses Issue and Bug creation entirely.
- **`BugMatcher` is a real collaborator, not orchestration.** It's the only place that talks to the LLM, with its own system prompt for semantic dedup. Constructor-injected so tests can swap it.

## Dependencies

- `@autonoma/ai` - `ObjectGenerator` + `LanguageModel` for the BugMatcher
- `@autonoma/db` - Prisma client
- `@autonoma/logger`
- `@autonoma/types` - `GenerationVerdict`, `ReplayVerdict`, etc.
