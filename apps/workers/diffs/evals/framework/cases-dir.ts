import path from "node:path";
import { logger as rootLogger } from "@autonoma/logger";
import { env } from "./env";

/**
 * Resolve the on-disk cases directory for an eval `suite` (e.g. `"healing"`).
 *
 * Cases live in a private corpus repo located via the optional
 * `DIFFS_EVAL_CASES_DIR` env var (see `evals/README.md`). The corpus mirrors the
 * public `evals/<suite>/cases` layout - `DIFFS_EVAL_CASES_DIR` simply stands in
 * for the `evals/` prefix - so each suite resolves to
 * `${DIFFS_EVAL_CASES_DIR}/<suite>/cases`.
 *
 * Returns `undefined` when the var is unset. Suites that *load* cases pass the
 * result straight to `loadCases`, which no-ops to zero cases; *capture* commands
 * must instead treat `undefined` as a hard error via {@link requireCasesDir}.
 */
export function resolveCasesDir(suite: string): string | undefined {
    const root = env.DIFFS_EVAL_CASES_DIR;
    if (root == null) {
        rootLogger
            .child({ name: "resolveCasesDir" })
            .info("DIFFS_EVAL_CASES_DIR is unset; resolving zero cases", { extra: { suite } });
        return undefined;
    }
    return path.join(root, suite, "cases");
}

/**
 * Cases directory for a capture command. Capture genuinely requires the corpus
 * root - there is nowhere to write a captured case without it - so an unset
 * `DIFFS_EVAL_CASES_DIR` is a hard error with a clear remediation message rather
 * than a silent no-op.
 */
export function requireCasesDir(suite: string): string {
    const dir = resolveCasesDir(suite);
    if (dir == null) {
        throw new Error(
            "DIFFS_EVAL_CASES_DIR is not set. Capture writes into the private eval-cases corpus. " +
                "Clone it alongside this repo and `export DIFFS_EVAL_CASES_DIR=/path/to/eval-cases` " +
                "(see apps/workers/diffs/evals/README.md).",
        );
    }
    return dir;
}
