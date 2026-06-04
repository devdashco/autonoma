import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Eval-only environment.
 *
 * Kept separate from the worker's `src/env.ts` on purpose: that module requires
 * the `GITHUB_APP_*` credentials at import time, whereas the eval harness is
 * designed to run credential-free over the on-disk repo cache (only minting a
 * GitHub token, and thus importing `src/env.ts`, when an uncached SHA actually
 * has to be fetched - see `framework/codebase-cache.ts`). Pulling `src/env.ts`
 * into eval-suite collection would re-introduce that credential requirement and
 * break the zero-cases no-op for external contributors.
 *
 * `DIFFS_EVAL_CASES_DIR` is the root of the **private eval-cases corpus** (see
 * `evals/README.md`). The corpus carries client data and so never lives in this
 * open-source repo. It is optional: when unset the eval suites load zero cases
 * and no-op, while the capture commands fail with a clear message.
 */
export const env = createEnv({
    server: {
        DIFFS_EVAL_CASES_DIR: z.string().min(1).optional(),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
});
