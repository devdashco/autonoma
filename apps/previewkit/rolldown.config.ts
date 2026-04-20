import { builtinModules } from "node:module";
import { defineConfig } from "rolldown";

const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig({
    input: { index: "src/index.ts" },
    output: {
        dir: "dist",
        format: "esm",
        sourcemap: true,
        entryFileNames: "[name].js",
        minify: true,
    },
    platform: "node",
    external: nodeBuiltins,
});
