import { join } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Eval files (`evals/**/*.eval.ts`) are only collected when RUN_EVALS=true, so
// `pnpm test` stays fast and DB/credential-free while `pnpm eval` runs the
// scored, network-touching evaluations.
const includeEvals = process.env.RUN_EVALS === "true";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts", ...(includeEvals ? ["evals/**/*.eval.ts"] : [])],
        exclude: ["**/dist/**", "**/node_modules/**"],
        env: { ...config({ path: join(__dirname, "../../../.env") }).parsed },
        watch: false,
    },
});
