#!/usr/bin/env node
// Reads a Next.js `next.config.{js,mjs,ts}` and prints the resolved `output`
// field as `{"output": "<value>"|null}` on stdout. Used by previewkit's
// turbo-monorepo build path to decide whether to invoke the standalone
// server (`node .next/standalone/server.js`) or fall back to `<pm> run start`.
//
// Spawned with two runtimes:
//   - `node`  for .js + .mjs (no native TS support)
//   - `bun`   as fallback for .ts and any ESM/CJS edge cases node trips on
//
// Exits non-zero on any error. The caller treats non-zero as "couldn't
// evaluate; use the safe default" and tries the other runtime, then
// emits a warn log if both fail.

import { pathToFileURL } from "node:url";

const configPath = process.argv[2];
if (!configPath) {
    process.stderr.write("Usage: read-next-config <absolute-path-to-next.config>\n");
    process.exit(2);
}

try {
    // pathToFileURL is required for node to accept an absolute path. Bun
    // accepts both forms; using file:// works under both.
    const mod = await import(pathToFileURL(configPath).href);

    // Next supports:
    //   ESM:  `export default { ... }`              → mod.default = {...}
    //   ESM:  `export default async (phase) => ...` → mod.default is a function
    //   CJS:  `module.exports = { ... }`            → mod.default = {...} when imported via dynamic import
    //   CJS:  `module.exports = async (phase) => ...`
    // The `?? mod` fallback covers exotic shapes where someone exports the
    // config as a named export. Next itself wouldn't read those, but
    // defending against it costs nothing.
    const exported = mod.default ?? mod;

    // Pass minimally realistic args to function configs. Next calls these
    // with `(phase, { defaultConfig })` where phase is e.g.
    // 'phase-production-build'. If the user's function depends on a real
    // defaultConfig we'd get an `undefined` access here - that's a
    // legitimate eval failure and we exit non-zero.
    const resolved = typeof exported === "function" ? await exported("phase-production-build", { defaultConfig: {} }) : exported;

    const output = resolved && typeof resolved === "object" ? resolved.output : undefined;
    process.stdout.write(JSON.stringify({ output: output ?? null }));
} catch (err) {
    process.stderr.write(err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err));
    process.exit(1);
}
