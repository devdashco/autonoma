import { defineConfig } from "vitest/config";

// Real-apiserver tests that drive BuildKitJobManager against a local `kind`
// cluster (Kubernetes IN Docker). Opt-in only - NOT part of `pnpm test` or the
// Postgres integration suite. Run with `pnpm --filter @autonoma/previewkit test:kind`.
// Requires the `kind` binary and a running Docker daemon. The suite creates and
// targets a dedicated kind cluster by name and refuses to touch any other
// cluster (see the safety guard in test/kind/setup.ts).
export default defineConfig({
    test: {
        globals: true,
        include: ["test/kind/**/*.test.ts"],
        // Cluster + namespace lifecycle is slow and order-sensitive.
        fileParallelism: false,
        testTimeout: 120_000,
        hookTimeout: 180_000,
    },
});
