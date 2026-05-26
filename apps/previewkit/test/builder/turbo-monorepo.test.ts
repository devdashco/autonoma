import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    detectNextStandalone,
    detectNonNodeRootManifests,
    detectPackageManager,
    planTurboMonorepoBuild,
    provisionRailpackNodeOverride,
    resolveStartCommand,
    resolveTurboFilter,
    shellQuote,
} from "../../src/builder/turbo-monorepo";

/**
 * Fixture monorepo materialized to a tmpdir per test. Files are declared
 * inline so they never appear in editor/fuzzy file search the way an
 * on-disk test/fixtures/ tree would. The minimal shape captures every input
 * the turbo-monorepo planner reads: lockfile, package.json name, Cargo.toml
 * at root (to exercise the provider-override guard), next.config.
 */
type Fixture = Record<string, string>;

async function materialize(fixture: Fixture): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "previewkit-turbo-fixture-"));
    for (const [relPath, contents] of Object.entries(fixture)) {
        const full = join(root, relPath);
        await mkdirpAndWrite(full, contents);
    }
    return root;
}

async function mkdirpAndWrite(filePath: string, contents: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
}

let cleanupPaths: string[] = [];

beforeEach(() => {
    cleanupPaths = [];
});

afterEach(async () => {
    await Promise.all(
        cleanupPaths.map((p) =>
            rm(p, { recursive: true, force: true }).catch((err: unknown) => {
                console.warn(`[turbo-monorepo.test] failed to clean up fixture dir ${p}:`, err);
            }),
        ),
    );
});

async function tmpFixture(fixture: Fixture): Promise<string> {
    const root = await materialize(fixture);
    cleanupPaths.push(root);
    return root;
}

describe("detectPackageManager", () => {
    it("returns bun when bun.lock exists", async () => {
        const root = await tmpFixture({ "bun.lock": "# bun text lockfile\n" });
        expect(detectPackageManager(root)).toBe("bun");
    });

    it("returns bun when only the legacy bun.lockb exists", async () => {
        const root = await tmpFixture({ "bun.lockb": "binary" });
        expect(detectPackageManager(root)).toBe("bun");
    });

    it("returns pnpm when pnpm-lock.yaml exists", async () => {
        const root = await tmpFixture({ "pnpm-lock.yaml": "lockfileVersion: 9\n" });
        expect(detectPackageManager(root)).toBe("pnpm");
    });

    it("returns yarn when yarn.lock exists", async () => {
        const root = await tmpFixture({ "yarn.lock": "# yarn\n" });
        expect(detectPackageManager(root)).toBe("yarn");
    });

    it("falls back to npm when no lockfile is present", async () => {
        const root = await tmpFixture({ "package.json": "{}" });
        expect(detectPackageManager(root)).toBe("npm");
    });

    it("throws when bun and pnpm lockfiles coexist (likely a stale leftover)", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "pnpm-lock.yaml": "#\n",
        });
        expect(() => detectPackageManager(root)).toThrow(/competing lockfiles.*bun, pnpm/);
    });

    it("throws when bun and package-lock.json coexist", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "package-lock.json": "{}",
        });
        expect(() => detectPackageManager(root)).toThrow(/competing lockfiles.*bun, npm/);
    });

    it("throws when all four package managers leave lockfiles behind", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "pnpm-lock.yaml": "#\n",
            "yarn.lock": "#\n",
            "package-lock.json": "{}",
        });
        expect(() => detectPackageManager(root)).toThrow(/competing lockfiles/);
    });

    it("returns npm when only package-lock.json is present", async () => {
        const root = await tmpFixture({ "package-lock.json": "{}" });
        expect(detectPackageManager(root)).toBe("npm");
    });
});

describe("resolveTurboFilter", () => {
    it("uses the package.json name field when present", async () => {
        const root = await tmpFixture({
            "apps/web/package.json": JSON.stringify({ name: "@scope/web" }),
        });
        expect(resolveTurboFilter(join(root, "apps/web"), "apps/web")).toBe("--filter=@scope/web");
    });

    it("falls back to path-based filter when name is missing", async () => {
        const root = await tmpFixture({
            "apps/web/package.json": JSON.stringify({ version: "1.0.0" }),
        });
        expect(resolveTurboFilter(join(root, "apps/web"), "apps/web")).toBe("--filter=./apps/web");
    });

    it("falls back to path-based filter when package.json is unreadable JSON", async () => {
        const root = await tmpFixture({
            "apps/web/package.json": "{ this is not json",
        });
        expect(resolveTurboFilter(join(root, "apps/web"), "apps/web")).toBe("--filter=./apps/web");
    });

    it("falls back to path-based filter when package.json is absent", async () => {
        const root = await tmpFixture({});
        expect(resolveTurboFilter(join(root, "apps/web"), "apps/web")).toBe("--filter=./apps/web");
    });
});

describe("detectNextStandalone", () => {
    it("returns true for next.config.js with standalone output", async () => {
        const root = await tmpFixture({
            "apps/web/next.config.js": "module.exports = { output: 'standalone' };",
        });
        expect(detectNextStandalone(join(root, "apps/web"))).toBe(true);
    });

    it("returns true for next.config.mjs with double-quoted standalone", async () => {
        const root = await tmpFixture({
            "apps/web/next.config.mjs": 'export default { output: "standalone" };',
        });
        expect(detectNextStandalone(join(root, "apps/web"))).toBe(true);
    });

    it("returns false when next.config exists but has no standalone output", async () => {
        const root = await tmpFixture({
            "apps/web/next.config.js": "module.exports = { reactStrictMode: true };",
        });
        expect(detectNextStandalone(join(root, "apps/web"))).toBe(false);
    });

    it("returns false when no next.config files are present", async () => {
        const root = await tmpFixture({ "apps/web/package.json": "{}" });
        expect(detectNextStandalone(join(root, "apps/web"))).toBe(false);
    });

    /**
     * Real evaluation makes this trivially correct - the comment text is
     * ignored at parse time, not by us. The OLD regex implementation
     * matched the literal `output: 'standalone'` inside the comment and
     * would falsely select the standalone start command, crashing the
     * container at boot. This test pins the new behavior.
     */
    it("ignores `output: 'standalone'` mentioned only inside a comment", async () => {
        const root = await tmpFixture({
            "apps/api/next.config.js":
                "// No `output: 'standalone'` here - we want the fallback start command\nmodule.exports = {};",
        });
        expect(detectNextStandalone(join(root, "apps/api"))).toBe(false);
    });

    it("evaluates the value when output is computed from an expression", async () => {
        const root = await tmpFixture({
            "apps/web/next.config.js": "const mode = ['stand', 'alone'].join('');\nmodule.exports = { output: mode };",
        });
        expect(detectNextStandalone(join(root, "apps/web"))).toBe(true);
    });

    it("handles async function configs and awaits them", async () => {
        const root = await tmpFixture({
            "apps/web/next.config.js": "module.exports = async () => ({ output: 'standalone' });",
        });
        expect(detectNextStandalone(join(root, "apps/web"))).toBe(true);
    });

    it("returns false when the config throws (graceful fallback, not a hard error)", async () => {
        const root = await tmpFixture({
            "apps/api/next.config.js": "throw new Error('config blew up - simulating wrapper deps not installed');",
        });
        // Build still proceeds. Warn is logged inside detectNextStandalone.
        expect(detectNextStandalone(join(root, "apps/api"))).toBe(false);
    });

    it("returns false when the config imports a module that isn't installed (the real wrapper case)", async () => {
        const root = await tmpFixture({
            "apps/api/next.config.mjs":
                "import { withSentryConfig } from '@sentry/nextjs-not-real';\nexport default withSentryConfig({ output: 'standalone' });",
        });
        expect(detectNextStandalone(join(root, "apps/api"))).toBe(false);
    });
});

describe("resolveStartCommand", () => {
    it("emits the standalone server command when Next.js standalone is detected", async () => {
        const root = await tmpFixture({
            "apps/web/next.config.js": "module.exports = { output: 'standalone' };",
        });
        expect(resolveStartCommand(join(root, "apps/web"), "apps/web", "bun")).toBe(
            "node apps/web/.next/standalone/server.js",
        );
    });

    it("falls back to `cd <dir> && <pm> run start` otherwise", async () => {
        const root = await tmpFixture({ "apps/web/package.json": "{}" });
        expect(resolveStartCommand(join(root, "apps/web"), "apps/web", "pnpm")).toBe("cd apps/web && pnpm run start");
    });
});

describe("shellQuote", () => {
    it("wraps plain values in single quotes", () => {
        expect(shellQuote("hello")).toBe("'hello'");
    });

    it("preserves whitespace and shell metacharacters", () => {
        expect(shellQuote("https://api.example.com/?a=1&b=2")).toBe("'https://api.example.com/?a=1&b=2'");
    });

    it("escapes embedded single quotes the POSIX way", () => {
        expect(shellQuote("it's")).toBe("'it'\\''s'");
    });
});

describe("planTurboMonorepoBuild", () => {
    it("produces the full plan for a bun + turbo monorepo with standalone Next.js", async () => {
        const root = await tmpFixture({
            "bun.lock": "# bun\n",
            "package.json": JSON.stringify({ name: "root", workspaces: ["apps/*"] }),
            "turbo.json": JSON.stringify({ tasks: { build: {} } }),
            "Cargo.toml": "[workspace]\nmembers = []\n",
            "apps/web/package.json": JSON.stringify({ name: "@scope/web", scripts: { build: "next build" } }),
            "apps/web/next.config.js": "module.exports = { output: 'standalone' };",
        });

        const plan = planTurboMonorepoBuild({
            buildContext: root,
            contextPath: join(root, "apps/web"),
            buildArgs: {
                NEXT_PUBLIC_API_URL: "https://api.example.com",
                NEXT_PUBLIC_TITLE: "Hello World",
            },
        });

        expect(plan.pm).toBe("bun");
        expect(plan.relAppDir).toBe("apps/web");
        expect(plan.filterArg).toBe("--filter=@scope/web");
        expect(plan.startCmd).toBe("node apps/web/.next/standalone/server.js");
        expect(plan.buildCmd).toBe(
            "NEXT_PUBLIC_API_URL='https://api.example.com' NEXT_PUBLIC_TITLE='Hello World' bun run turbo run build --filter=@scope/web",
        );
    });

    it("uses path-based filter and pm-run start when name and standalone are absent", async () => {
        const root = await tmpFixture({
            "pnpm-lock.yaml": "#\n",
            "apps/web/package.json": JSON.stringify({ scripts: { start: "node server.js" } }),
        });

        const plan = planTurboMonorepoBuild({
            buildContext: root,
            contextPath: join(root, "apps/web"),
            buildArgs: {},
        });

        expect(plan.pm).toBe("pnpm");
        expect(plan.filterArg).toBe("--filter=./apps/web");
        expect(plan.startCmd).toBe("cd apps/web && pnpm run start");
        expect(plan.buildCmd).toBe("pnpm run turbo run build --filter=./apps/web");
    });

    it("handles buildArgs with single quotes safely (POSIX-escaped inline)", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "apps/web/package.json": JSON.stringify({ name: "web" }),
        });

        const plan = planTurboMonorepoBuild({
            buildContext: root,
            contextPath: join(root, "apps/web"),
            buildArgs: { GREETING: "it's me" },
        });

        expect(plan.buildCmd).toBe("GREETING='it'\\''s me' bun run turbo run build --filter=web");
    });
});

describe("detectNonNodeRootManifests", () => {
    it("flags Cargo.toml (the Sandstone case)", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "Cargo.toml": "[workspace]\nmembers = []\n",
            "package.json": JSON.stringify({ name: "root" }),
        });
        expect(detectNonNodeRootManifests(root)).toEqual(["Cargo.toml"]);
    });

    it("flags Python manifests (requirements.txt, pyproject.toml, Pipfile)", async () => {
        const root = await tmpFixture({
            "requirements.txt": "flask==2.0.0\n",
            "pyproject.toml": "[project]\nname = 'x'\n",
            Pipfile: "[packages]\n",
        });
        expect(detectNonNodeRootManifests(root)).toEqual(["requirements.txt", "pyproject.toml", "Pipfile"]);
    });

    it("flags Gemfile, go.mod and JVM build files", async () => {
        const root = await tmpFixture({
            Gemfile: "source 'https://rubygems.org'\n",
            "go.mod": "module x\n",
            "pom.xml": "<project/>\n",
            "build.gradle": "plugins {}\n",
            "build.gradle.kts": "plugins {}\n",
        });
        expect(detectNonNodeRootManifests(root)).toEqual([
            "Gemfile",
            "go.mod",
            "pom.xml",
            "build.gradle",
            "build.gradle.kts",
        ]);
    });

    it("returns empty for a pure JS/TS monorepo", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "package.json": JSON.stringify({ name: "root" }),
            "apps/web/package.json": JSON.stringify({ name: "web" }),
        });
        expect(detectNonNodeRootManifests(root)).toEqual([]);
    });
});

describe("provisionRailpackNodeOverride", () => {
    it("writes {provider: node} when no railpack.json exists, even with Cargo.toml at root", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "Cargo.toml": "[workspace]\nmembers = []\n",
            "package.json": JSON.stringify({ name: "root" }),
        });

        const cleanup = await provisionRailpackNodeOverride(root);

        const written = await readFile(join(root, "railpack.json"), "utf8");
        expect(JSON.parse(written)).toEqual({ provider: "node" });

        await cleanup();
        expect(existsSync(join(root, "railpack.json"))).toBe(false);
    });

    it("respects an existing railpack.json and the cleanup is a no-op", async () => {
        const userConfig = { provider: "python", build: { commands: ["python -m build"] } };
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "railpack.json": JSON.stringify(userConfig),
        });

        const cleanup = await provisionRailpackNodeOverride(root);

        // User config left untouched.
        const after = await readFile(join(root, "railpack.json"), "utf8");
        expect(JSON.parse(after)).toEqual(userConfig);

        await cleanup();
        // Still there after cleanup - we didn't write it, we don't remove it.
        const afterCleanup = await readFile(join(root, "railpack.json"), "utf8");
        expect(JSON.parse(afterCleanup)).toEqual(userConfig);
    });

    it("cleanup tolerates the file already being gone (idempotent)", async () => {
        const root = await tmpFixture({ "bun.lock": "#\n" });

        const cleanup = await provisionRailpackNodeOverride(root);
        await rm(join(root, "railpack.json"), { force: true });

        // Second cleanup must not throw.
        await expect(cleanup()).resolves.toBeUndefined();
    });

    it("writing then re-running provision does not nest overrides", async () => {
        const root = await tmpFixture({ "bun.lock": "#\n", "Cargo.toml": "[workspace]\n" });

        const cleanup1 = await provisionRailpackNodeOverride(root);
        // Second call sees the railpack.json we just wrote and treats it as
        // user-owned, returning a no-op cleanup. This prevents the second
        // cleanup from deleting the first's file out from under it.
        const cleanup2 = await provisionRailpackNodeOverride(root);

        expect(existsSync(join(root, "railpack.json"))).toBe(true);
        await cleanup2();
        expect(existsSync(join(root, "railpack.json"))).toBe(true);
        await cleanup1();
        expect(existsSync(join(root, "railpack.json"))).toBe(false);
    });
});

describe("planTurboMonorepoBuild - negative & edge cases", () => {
    it("throws when contextPath is outside buildContext (sibling dir)", async () => {
        const root = await tmpFixture({
            "monorepo/bun.lock": "#\n",
            "outside/apps/web/package.json": JSON.stringify({ name: "web" }),
        });
        expect(() =>
            planTurboMonorepoBuild({
                buildContext: join(root, "monorepo"),
                contextPath: join(root, "outside/apps/web"),
                buildArgs: {},
            }),
        ).toThrow(/outside the monorepo root/);
    });

    it("throws when contextPath is a parent of buildContext", async () => {
        const root = await tmpFixture({
            "monorepo/bun.lock": "#\n",
            "monorepo/apps/web/package.json": JSON.stringify({ name: "web" }),
        });
        expect(() =>
            planTurboMonorepoBuild({
                buildContext: join(root, "monorepo/apps"),
                contextPath: root,
                buildArgs: {},
            }),
        ).toThrow(/outside the monorepo root/);
    });

    it("throws when the monorepo root has competing lockfiles", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "yarn.lock": "#\n",
            "apps/web/package.json": JSON.stringify({ name: "web" }),
        });
        expect(() =>
            planTurboMonorepoBuild({
                buildContext: root,
                contextPath: join(root, "apps/web"),
                buildArgs: {},
            }),
        ).toThrow(/competing lockfiles/);
    });

    /**
     * Documented behavior: when monorepo:true is set on a single-app repo,
     * relAppDir falls back to "." and we produce `--filter=./.` plus
     * `cd . && bun run start`. This is suspect (it suggests misconfiguration)
     * but the resulting commands are valid - turbo accepts the self-filter
     * and `cd .` is a no-op. We do not throw because there are legitimate
     * cases (single-package workspaces) where this works.
     */
    it("produces a self-targeting plan when buildContext === contextPath", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "package.json": JSON.stringify({ name: "solo" }),
        });
        const plan = planTurboMonorepoBuild({
            buildContext: root,
            contextPath: root,
            buildArgs: {},
        });
        expect(plan.relAppDir).toBe(".");
        expect(plan.filterArg).toBe("--filter=solo");
        expect(plan.startCmd).toBe("cd . && bun run start");
        expect(plan.buildCmd).toBe("bun run turbo run build --filter=solo");
    });

    it("escapes build args containing newlines so the shell line stays a single command", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "apps/web/package.json": JSON.stringify({ name: "web" }),
        });
        const plan = planTurboMonorepoBuild({
            buildContext: root,
            contextPath: join(root, "apps/web"),
            buildArgs: { MULTILINE: "first\nsecond" },
        });
        // The newline lives inside the single-quoted value; the build line
        // remains a single shell command from the parser's perspective.
        expect(plan.buildCmd).toBe("MULTILINE='first\nsecond' bun run turbo run build --filter=web");
        // No unescaped newline can split the build arg from the turbo invocation.
        const beforeTurbo = plan.buildCmd.split("bun run turbo")[0] ?? "";
        const singleQuoteCount = (beforeTurbo.match(/'/g) ?? []).length;
        expect(singleQuoteCount % 2).toBe(0);
    });

    it("escapes build args containing `=`, `;`, `&`, and `$` so the shell does not interpret them", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "apps/web/package.json": JSON.stringify({ name: "web" }),
        });
        const plan = planTurboMonorepoBuild({
            buildContext: root,
            contextPath: join(root, "apps/web"),
            buildArgs: {
                MIXED: "a=b;rm -rf /&&echo $PATH",
            },
        });
        expect(plan.buildCmd).toBe("MIXED='a=b;rm -rf /&&echo $PATH' bun run turbo run build --filter=web");
    });

    it("passes through non-ASCII characters in package name and build args", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "apps/web/package.json": JSON.stringify({ name: "@scope/web-café" }),
        });
        const plan = planTurboMonorepoBuild({
            buildContext: root,
            contextPath: join(root, "apps/web"),
            buildArgs: { GREETING: "héllo 世界" },
        });
        expect(plan.filterArg).toBe("--filter=@scope/web-café");
        expect(plan.buildCmd).toBe("GREETING='héllo 世界' bun run turbo run build --filter=@scope/web-café");
    });

    it("produces no env prefix when buildArgs is empty", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "apps/web/package.json": JSON.stringify({ name: "web" }),
        });
        const plan = planTurboMonorepoBuild({
            buildContext: root,
            contextPath: join(root, "apps/web"),
            buildArgs: {},
        });
        expect(plan.buildCmd.startsWith("bun ")).toBe(true);
        expect(plan.buildCmd).toBe("bun run turbo run build --filter=web");
    });

    /**
     * Empty-string build arg values are technically valid (e.g.
     * NEXT_PUBLIC_FEATURE_FLAG="" to set an env var to empty). The shell
     * sees `KEY=''` which sets KEY to an empty string, not unsets it.
     */
    it("emits empty-string build args as KEY=''", async () => {
        const root = await tmpFixture({
            "bun.lock": "#\n",
            "apps/web/package.json": JSON.stringify({ name: "web" }),
        });
        const plan = planTurboMonorepoBuild({
            buildContext: root,
            contextPath: join(root, "apps/web"),
            buildArgs: { EMPTY: "" },
        });
        expect(plan.buildCmd).toBe("EMPTY='' bun run turbo run build --filter=web");
    });
});

/**
 * Opt-in: runs the real `railpack` binary against an inline-materialized
 * monorepo fixture to verify the generated plan really does invoke `bun
 * install` (the failure mode we are fixing). Skipped automatically when the
 * binary is not on PATH so CI without railpack stays green; developers with
 * railpack installed locally still get the coverage.
 */
function hasRailpack(): boolean {
    try {
        execFileSync("railpack", ["--version"], { stdio: "ignore" });
        return true;
    } catch (err) {
        console.warn("[turbo-monorepo.test] railpack binary not found, skipping real-railpack test:", err);
        return false;
    }
}

describe.skipIf(!hasRailpack())("real railpack against fixture monorepo", () => {
    it("generates a plan that runs `bun install` (not `npm install`)", async () => {
        const root = await tmpFixture({
            "bun.lock": "# bun lockfile\n",
            "package.json": JSON.stringify({
                name: "root",
                workspaces: ["apps/*"],
                packageManager: "bun@1.1.0",
            }),
            "turbo.json": JSON.stringify({ tasks: { build: {} } }),
            "Cargo.toml": "[workspace]\nmembers = []\n",
            "apps/web/package.json": JSON.stringify({
                name: "@scope/web",
                scripts: { build: "echo built", start: "echo started" },
            }),
            "railpack.json": JSON.stringify({ provider: "node" }),
        });

        const plan = planTurboMonorepoBuild({
            buildContext: root,
            contextPath: join(root, "apps/web"),
            buildArgs: {},
        });

        const planOut = join(root, "railpack-plan.json");
        execFileSync(
            "railpack",
            ["prepare", root, "--build-cmd", plan.buildCmd, "--start-cmd", plan.startCmd, "--plan-out", planOut],
            { stdio: "pipe" },
        );

        const planJson = await readFile(planOut, "utf8");
        expect(planJson).toMatch(/bun\s+install/i);
        expect(planJson).not.toMatch(/npm\s+install/i);
    }, 30_000);
});
