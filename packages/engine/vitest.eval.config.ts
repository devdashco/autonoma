import { join } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Live-model command tests only: real, paid, non-deterministic API calls that need API keys.
        // Run on demand via `pnpm eval`, never as part of `pnpm test` (which uses vitest.config.ts and
        // is scoped to deterministic units).
        include: ["src/**/*.eval.test.ts"],
        exclude: ["**/dist/**", "**/node_modules/**"],
        env: {
            DATABASE_URL: "postgresql://placeholder:placeholder@localhost:5432/placeholder",
            ...config({ path: join(__dirname, "../../.env") }).parsed,
        },
        testTimeout: 60_000,
    },
});
