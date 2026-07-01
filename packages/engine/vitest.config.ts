import { join } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Deterministic, key-free unit tests only. The `*.eval.test.ts` command tests make real,
        // paid, non-deterministic model calls (point detection + visual condition checks) and are
        // deliberately excluded so `pnpm test` (turbo, CI) never needs API keys. Run them on demand
        // with `pnpm eval` (see vitest.eval.config.ts).
        exclude: ["**/dist/**", "**/node_modules/**", "**/*.eval.test.ts"],
        env: {
            DATABASE_URL: "postgresql://placeholder:placeholder@localhost:5432/placeholder",
            ...config({ path: join(__dirname, "../../.env") }).parsed,
        },
        testTimeout: 30_000,
    },
});
