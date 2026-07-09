import type { Build } from "../config/schema";

/** A node-family framework preset (node / next / vite / bun) - the discriminated arms that use a node package manager. */
type NodeFrameworkBuild = Exclude<Build, { framework: "dockerfile" | "runtime" }>;

/** The resolved install / build / run / bootstrap commands for a node-family build (bare, without the `RUN`/`CMD` prefix). */
export interface NodeBuildCommands {
    /** Pre-`COPY` bootstrap (e.g. `corepack enable`), or undefined when none is needed. */
    bootstrap?: string;
    install: string;
    build: string;
    run: string;
}

interface NodeToolStrategy {
    /** CLI prefix (`pnpm`, `bun`, ...). */
    cli: string;
    /** Bootstrap command needed before install (corepack for pnpm/yarn), or undefined. */
    bootstrap?: string;
    /** Default install command. */
    install: string;
}

/**
 * Node package-manager strategies. npm ships with node and bun ships in its own
 * image, so neither needs a bootstrap; pnpm/yarn activate through corepack.
 * Adding a manager is one entry here, not a branch in the generator.
 */
const NODE_TOOLS = {
    npm: { cli: "npm", install: "npm ci" },
    pnpm: { cli: "pnpm", bootstrap: "corepack enable", install: "pnpm install --frozen-lockfile" },
    yarn: { cli: "yarn", bootstrap: "corepack enable", install: "yarn install --frozen-lockfile" },
    bun: { cli: "bun", install: "bun install" },
} satisfies Record<string, NodeToolStrategy>;

/**
 * Resolves the install / build / run / bootstrap commands for a node-family build
 * from its package manager, framework, and build context - each defaulted here
 * and overridable via the build's explicit `*_command` fields. `build_context:
 * root` builds/starts through a turbo `--filter` for monorepos; vite serves its
 * static preview.
 */
export function nodeBuildCommands(build: NodeFrameworkBuild, appName: string): NodeBuildCommands {
    const tool: NodeToolStrategy = build.framework === "bun" ? NODE_TOOLS.bun : NODE_TOOLS[build.package_manager];
    const root = build.build_context === "root";
    return {
        bootstrap: tool.bootstrap,
        install: build.install_command ?? tool.install,
        build: build.build_command ?? defaultBuildCommand(tool.cli, appName, root),
        run: build.run_command ?? defaultRunCommand(tool.cli, appName, root, build.framework),
    };
}

function defaultBuildCommand(cli: string, appName: string, root: boolean): string {
    return root ? `${cli} turbo run build --filter=${appName}` : `${cli} run build`;
}

function defaultRunCommand(
    cli: string,
    appName: string,
    root: boolean,
    framework: NodeFrameworkBuild["framework"],
): string {
    if (root) return `${cli} turbo run start --filter=${appName}`;
    if (framework === "vite") return `${cli} run preview`;
    return `${cli} start`;
}
