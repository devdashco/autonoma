import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/integration/**/*.test.ts"],
        fileParallelism: false,
        testTimeout: 30_000,
        env: {
            // Skips env validation in src/env.ts so the spool's internal logger
            // initializes without requiring the full service env.
            TESTING: "true",
        },
    },
});
