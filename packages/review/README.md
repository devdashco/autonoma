# @autonoma/review

The reviewer system: generation review (4-outcome classifier) and replay review (binary classifier), built on a shared agent-loop kernel.

## Layout

```
src/
├── kernel/        Generic agent-loop primitives shared by every reviewer.
├── generation/    GenerationReviewer: 4-outcome verdict, runs on every generation.
├── replay/        ReplayReviewer: binary verdict, failure-only.
└── index.ts       Public re-exports.
```

This mirrors `@autonoma/engine`'s layout (execution-agent + replay-engine in one package). Internal subdirectories instead of separate packages keeps refactoring across the boundary cheap and avoids workspace ceremony for a kernel that has no third consumer.

## kernel/

Domain-agnostic primitives. Knows nothing about generations, replays, plans, issues, or bugs.

| Export | Description |
|--------|-------------|
| `runReviewAgent<TVerdict>` | Runs a `ToolLoopAgent` until the verdict tool fires or `maxSteps` is hit. Generic over the verdict shape. |
| `buildScreenshotTools` | Returns `view_step_screenshot` + `view_final_screenshot`. |
| `buildVerdictTool(schema)` | Builds the terminal `submit_verdict` tool against any Zod schema. |
| `extractVerdict<T>(steps, name?)` | Walks the tool-loop trace looking for the verdict call. |
| `tryUploadVideo` | Best-effort upload to the GenAI Files API; returns `undefined` on failure. |
| `MessageBuilder` | Fluent builder for `ModelMessage[]` (sections, video, appended messages, closing prompt). |
| `sanitizeConversation` | Strips images and `providerOptions` from a foreign agent's conversation. |
| `ScreenshotLoader`, `VideoDownloader`, `ReviewStepScreenshots` | Interfaces. |

## generation/

The Generation Reviewer. Runs on **every** generation (success and failure) and is the authority on the true outcome — its verdict overrides the execution agent's self-report.

Verdicts: `success | agent_limitation | application_bug | plan_mismatch`.

| Export | Description |
|--------|-------------|
| `GenerationContextLoader` | Postgres + S3 -> `GenerationContext` value object. |
| `buildGenerationReviewMessages` | `GenerationContext` + uploaded video -> `ModelMessage[]`. |
| `GenerationReviewer` | Runs the agent loop, returns a `GenerationVerdict`. |
| `GenerationReviewPersister` | Writes the verdict to the `GenerationReview` row. Does not create Issues/Bugs - that's `@autonoma/issue-reporter`'s job. |
| `runGenerationReview(generationId, deps?)` | Top-level entry point. Idempotent against an already-completed review. |

## replay/

The Replay Reviewer. Failure-only — skips runs whose status is not `failed`.

Verdicts: `engine_error | application_bug`.

Same shape as `generation/`: `RunContextLoader`, `buildReplayReviewMessages`, `ReplayReviewer`, `RunReviewPersister`, `runReplayReview(runId, deps?)`.

## Usage

```ts
import { runGenerationReview, runReplayReview } from "@autonoma/review";
import { CodebaseResolver } from "@autonoma/codebase";

const resolver = new CodebaseResolver({ db, githubApp });
const codebase = await resolver.cloneForGeneration(generationId, {
    targetDirSeed: `gen-${generationId}`,
});
try {
    const result = await runGenerationReview(generationId, { codebase });
    // result.verdict: GenerationVerdict | undefined
} finally {
    if (codebase != null) await codebase.dispose();
}
```

## Idempotency

`runGenerationReview` and `runReplayReview` are idempotent against an already-completed review (return `{ status: "skipped" }`).

## Local CLI

Two read-only scripts let you re-run a verdict against an existing generation/run without touching the DB. They compose `*ContextLoader` + `*Reviewer` directly - they do **not** go through `runGenerationReview` / `runReplayReview`, so there are no DB writes, no idempotency guard, and no `AiCostRecord`s.

```bash
pnpm --filter @autonoma/review review:generation <generationId>
pnpm --filter @autonoma/review review:replay <runId>
```

The replay CLI is failure-only - it logs and exits 0 if the run's `status` is not `failed`.

### Required env

| Var | Why |
|-----|-----|
| `DATABASE_URL` | Read the generation/run. |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Download conversation, screenshots, video. |
| `GEMINI_API_KEY`, `GROQ_KEY`, `OPENROUTER_API_KEY` | Model providers (default model: `GEMINI_3_FLASH_PREVIEW`). |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_SLUG` | Clone the application's repo at the snapshot's `headSha` so the agent gets `read_file` / `grep` / `list_directory` tools to ground its verdict in source. The clone targets `/tmp/codebase/cli-{gen,run}-<id>` and is disposed automatically. |

## Dependencies

- `@autonoma/ai` - model registry, video processor, cost collector, `ObjectGenerator`
- `@autonoma/codebase` - optional codebase tools
- `@autonoma/db` - Prisma client
- `@autonoma/storage` - S3 access for conversation/screenshots/video
- `@autonoma/types` - `GenerationVerdict`, `ReplayVerdict`, evidence + severity types
- `ai` (Vercel AI SDK) - `ToolLoopAgent`, message types
