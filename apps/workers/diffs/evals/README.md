# Diffs pipeline evals

Local, per-step, **scored** evaluations for the diffs pipeline - the replacement for
the eyeball-only local-dev scripts. Each step keeps a corpus of on-disk cases and
scores the agent's output with **deterministic frontmatter checks plus an LLM judge**.

This slice ships the shared framework and the first step: **Diff Analysis**.

```
evals/
├── framework/            # step-agnostic machinery
│   ├── codebase-cache.ts #   ensureCachedCheckout: rehydrate a Codebase from git coords
│   ├── case-loader.ts    #   load input.json + expected.md per case folder
│   ├── frontmatter.ts    #   shared deterministic-check primitives (sets, counts, bands)
│   └── judge.ts          #   output-only LLM judge with its own CostCollector
├── analysis/             # the Diff Analysis step
│   ├── analysis-input.ts        # frozen-input schema (codebase coords + flow array)
│   ├── analysis-frontmatter.ts  # affected.* / candidates.* checks
│   ├── analysis-evaluation.ts   # the Evaluation subclass
│   ├── analysis.eval.ts         # vitest entry (gated by RUN_EVALS)
│   └── cases/<name>/            # one folder per case: input.json + expected.md
└── capture/              # DB -> fixture capture
    └── capture.ts        #   `capture:analysis <snapshotId>`
```

## The eval-case contract

Each case is a folder under `analysis/cases/<name>/`:

- **`input.json`** - the **frozen, assembled `DiffsAgentInput`**, snapshotted at capture time so
  eval runs need no database. The codebase is stored as coordinates
  `{ owner, repo, installationId, baseSha, headSha }`; the `FlowIndex` is stored as its underlying
  array and reconstructed at load.
- **`expected.md`** - YAML frontmatter holds the **deterministic checks**; the body holds the
  **LLM-judge rubric**. A case passes iff **all frontmatter checks pass AND the judge passes**.

### Analysis frontmatter

```yaml
---
description: "what this case exercises"   # optional, ignored by checks
skip: false                                # when true, the case is loaded but not run
affected:                                  # checks over the affected-test slug set
  include: [slug-a]                        #   must be present
  exclude: [slug-b]                        #   must be absent
  exact: [slug-a, slug-c]                  #   the exact set (order-insensitive)
candidates:                                # bounds on the new-test-candidate count
  minCount: 1
  maxCount: 3
---

Free-text judge rubric. The judge sees only the agent's structured output plus this
body - never the codebase or screenshots. Write it ADDITIVE to the frontmatter: grade
qualities the deterministic checks cannot (sound reasoning, sensible candidates).
```

## Running the evals

Evals are gated behind `RUN_EVALS` and need real model credentials
(`GEMINI_API_KEY`, `GROQ_KEY`, `OPENROUTER_API_KEY`) plus `git` and `rg` on PATH. Private-repo
cases also need the `GITHUB_APP_*` credentials to mint a clone token; public-repo cases and cases
whose commits are already in the repo cache run without them.

```bash
pnpm --filter @autonoma/worker-diffs eval
```

- The suite runs **sequentially** - every case shares one on-disk working tree in the gitignored
  repo cache (`evals/.cache/repos/`), so concurrent checkouts are impossible.
- A case whose `baseSha`/`headSha` can no longer be fetched **skips with a warning** rather than
  red-failing the suite.
- A JSON result with a pass-rate is written to `analysis/results/` (gitignored).

## Capturing a case from a snapshot

```bash
pnpm --filter @autonoma/worker-diffs capture:analysis <snapshotId> [--name <case-name>] [--force]
```

This resolves the snapshot's git coordinates, **validates both SHAs are fetchable** (refusing to
write a case with a dead SHA), runs the production Analysis loaders against a real clone, freezes the
assembled input to `input.json`, and scaffolds a blank `expected.md` (`skip: true`). Fill in the
frontmatter checks and the rubric, then flip `skip: false`. Capture reads the DB; eval runs never
touch it.

**Baseline test suite.** Analysis grades the diff against the suite as it stood *before* this
snapshot's pipeline ran. At production analysis time the snapshot's own assignments are still a
fresh copy of that baseline, so the runner reads them directly. Capture, however, runs *after* the
pipeline has rewritten those assignments, so it loads the suite from the snapshot's **previous**
snapshot - the unmutated baseline - to reproduce exactly what analysis saw. This is controlled by
the `testSuiteSource` option on the shared `assembleDiffsAgentInput` loader (`"current"` for the
runner, `"previous"` for capture).
