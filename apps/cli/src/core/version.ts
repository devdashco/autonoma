import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@autonoma-ai/planner";

/**
 * The CLI's own version, read from this package's package.json.
 *
 * We deliberately do NOT use `process.env.npm_package_version`: that variable
 * is set by the package manager from whatever package.json context the process
 * was launched under. When a user runs the CLI inside their own repo (npx, a
 * project script, etc.) it reports the *user's* project version - which is why
 * analytics saw a scatter of bogus versions (0.0.0, 1.9.0, …) and `None` when
 * run as a bare global binary. Reading our own manifest fixes that.
 */
function resolveVersion(): string {
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        // Bundled: this code lives in dist/index.js, so package.json is one level
        // up. In dev (src/core/version.ts) it's two levels up. The name guard keeps
        // us from accidentally picking up the user's package.json.
        for (const rel of ["../package.json", "../../package.json", "../../../package.json"]) {
            try {
                const pkg = JSON.parse(readFileSync(join(here, rel), "utf-8"));
                if (pkg?.name === PACKAGE_NAME && typeof pkg.version === "string") {
                    return pkg.version;
                }
            } catch {
                // Keep looking - a missing or unrelated package.json at this level is fine.
            }
        }
    } catch {
        // import.meta.url unavailable or unreadable - fall through to "unknown".
    }
    return "unknown";
}

export const CLI_VERSION = resolveVersion();
