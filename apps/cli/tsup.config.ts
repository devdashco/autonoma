import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    // Down-level to our minimum supported runtime (engines.node >= 22.13) so we
    // never emit syntax that a supported Node can't parse.
    target: "node22",
    platform: "node",
    outDir: "dist",
    clean: true,
    sourcemap: true,
    splitting: false,
    shims: true,
    banner: { js: "#!/usr/bin/env node" },
});
