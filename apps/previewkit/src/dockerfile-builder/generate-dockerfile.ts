import type { Build } from "../config/schema";
import { mirrorDockerHubImage } from "../deployer/image-mirror";
import { logger as rootLogger } from "../logger";

/** Build shapes that produce a generated Dockerfile - everything except the user-Dockerfile case. */
type GeneratedBuild = Exclude<Build, { framework: "dockerfile" }>;

export interface GenerateDockerfileContext {
    /** ECR pull-through cache prefix for Docker Hub base images; "" disables mirroring. */
    registryMirror: string;
    /** Merged build args (build_args + resolved build_secrets); emitted as `ENV` lines. */
    buildArgs: Record<string, string>;
    /** Container port the app listens on; emitted as `ENV PORT` + `EXPOSE`. */
    port: number;
    /** App package name, used in the turbo `--filter` of the root-context default commands. */
    appName: string;
}

/**
 * Generates a single-stage Dockerfile for a framework-preset build: base image
 * -> install -> build -> `CMD <run>`. The install / build / run commands default
 * from the framework, package manager, and build context, each overridable. This
 * is intentionally NOT multi-stage yet - slim, static-optimized images (e.g. Caddy
 * serving a built SPA, production dependency pruning) are a later optimization.
 *
 * Only the generated frameworks (node / bun / next / vite) reach here; the
 * user-Dockerfile case is dispatched separately by the builder.
 */
export function generateDockerfile(build: GeneratedBuild, ctx: GenerateDockerfileContext): string {
    const logger = rootLogger.child({ name: "generateDockerfile" });
    logger.info("Generating Dockerfile", {
        framework: build.framework,
        buildContext: build.build_context,
        mirrorActive: ctx.registryMirror !== "",
        buildArgCount: Object.keys(ctx.buildArgs).length,
    });

    const lines: string[] = [
        "# syntax=docker/dockerfile:1.7",
        "",
        `FROM ${baseImage(build, ctx.registryMirror)}`,
        "WORKDIR /app",
        "",
    ];

    const bootstrap = packageManagerBootstrap(build);
    if (bootstrap != null) {
        lines.push(bootstrap, "");
    }

    lines.push("COPY . .", "");
    lines.push(installCommand(build), "");

    for (const line of envLines(ctx.buildArgs)) {
        lines.push(line);
    }
    lines.push(`ENV PORT=${ctx.port}`, "");

    lines.push(buildCommand(build, ctx.appName), "");
    lines.push(`EXPOSE ${ctx.port}`);
    lines.push(`CMD ${runCommand(build, ctx.appName)}`);

    logger.info("Dockerfile generated", { framework: build.framework });
    return lines.join("\n") + "\n";
}

function baseImage(build: GeneratedBuild, mirror: string): string {
    if (build.framework === "bun") {
        return mirrorDockerHubImage("oven/bun:1", mirror);
    }
    return mirrorDockerHubImage(`node:${build.node_version}-bookworm-slim`, mirror);
}

function packageManagerBootstrap(build: GeneratedBuild): string | undefined {
    // npm ships with node and bun ships in its own image; only pnpm/yarn need corepack.
    if (build.framework === "bun" || build.package_manager === "npm") {
        return undefined;
    }
    return "RUN corepack enable";
}

function tool(build: GeneratedBuild): string {
    return build.framework === "bun" ? "bun" : build.package_manager;
}

function installCommand(build: GeneratedBuild): string {
    if (build.install_command != null) return `RUN ${build.install_command}`;
    const pm = tool(build);
    if (pm === "bun") return "RUN bun install";
    if (pm === "npm") return "RUN npm ci";
    return `RUN ${pm} install --frozen-lockfile`;
}

function buildCommand(build: GeneratedBuild, appName: string): string {
    if (build.build_command != null) return `RUN ${build.build_command}`;
    const pm = tool(build);
    if (build.build_context === "root") return `RUN ${pm} turbo run build --filter=${appName}`;
    return `RUN ${pm} run build`;
}

function runCommand(build: GeneratedBuild, appName: string): string {
    if (build.run_command != null) return build.run_command;
    const pm = tool(build);
    if (build.build_context === "root") return `${pm} turbo run start --filter=${appName}`;
    if (build.framework === "vite") return `${pm} run preview`;
    return `${pm} start`;
}

function envLines(buildArgs: Record<string, string>): string[] {
    return Object.entries(buildArgs).map(([key, value]) => `ENV ${key}=${quoteEnv(value)}`);
}

/**
 * Quotes a build arg value for a Dockerfile `ENV` line: wraps in double quotes
 * and escapes the three characters special inside them (backslash, double quote,
 * dollar). Values are expected to be single-line.
 */
function quoteEnv(value: string): string {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
    return `"${escaped}"`;
}
