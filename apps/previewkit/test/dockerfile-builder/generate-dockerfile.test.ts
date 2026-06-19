import { describe, expect, it } from "vitest";
import { generateDockerfile, type GenerateDockerfileContext } from "../../src/dockerfile-builder/generate-dockerfile";

const ctx: GenerateDockerfileContext = { registryMirror: "", buildArgs: {}, port: 3000, appName: "web" };

describe("generateDockerfile", () => {
    it("generates a node + pnpm app-context Dockerfile with derived defaults", () => {
        const df = generateDockerfile(
            { framework: "node", package_manager: "pnpm", node_version: "22", build_context: "app" },
            ctx,
        );
        expect(df).toContain("FROM node:22-bookworm-slim");
        expect(df).toContain("RUN corepack enable");
        expect(df).toContain("RUN pnpm install --frozen-lockfile");
        expect(df).toContain("RUN pnpm run build");
        expect(df).toContain("ENV PORT=3000");
        expect(df).toContain("EXPOSE 3000");
        expect(df).toContain("CMD pnpm start");
    });

    it("uses the node_version in the base image tag", () => {
        const df = generateDockerfile(
            { framework: "node", package_manager: "pnpm", node_version: "20.11.0", build_context: "app" },
            ctx,
        );
        expect(df).toContain("FROM node:20.11.0-bookworm-slim");
    });

    it("generates a bun Dockerfile with the bun base image and no corepack", () => {
        const df = generateDockerfile({ framework: "bun", build_context: "app" }, ctx);
        expect(df).toContain("FROM oven/bun:1");
        expect(df).not.toContain("corepack");
        expect(df).toContain("RUN bun install");
        expect(df).toContain("RUN bun run build");
        expect(df).toContain("CMD bun start");
    });

    it("uses npm ci (no corepack) for the npm package manager", () => {
        const df = generateDockerfile(
            { framework: "node", package_manager: "npm", node_version: "22", build_context: "app" },
            ctx,
        );
        expect(df).not.toContain("corepack");
        expect(df).toContain("RUN npm ci");
        expect(df).toContain("CMD npm start");
    });

    it("defaults vite's run command to the preview script", () => {
        const df = generateDockerfile(
            { framework: "vite", package_manager: "pnpm", node_version: "22", build_context: "app" },
            ctx,
        );
        expect(df).toContain("CMD pnpm run preview");
    });

    it("uses turbo-filtered build and run commands for a root build context", () => {
        const df = generateDockerfile(
            { framework: "next", package_manager: "pnpm", node_version: "22", build_context: "root" },
            ctx,
        );
        expect(df).toContain("RUN pnpm turbo run build --filter=web");
        expect(df).toContain("CMD pnpm turbo run start --filter=web");
    });

    it("rewrites the base image through the registry mirror when set", () => {
        const df = generateDockerfile(
            { framework: "node", package_manager: "pnpm", node_version: "22", build_context: "app" },
            { ...ctx, registryMirror: "123.dkr.ecr.us-east-1.amazonaws.com/docker-hub" },
        );
        expect(df).toContain("FROM 123.dkr.ecr.us-east-1.amazonaws.com/docker-hub/library/node:22-bookworm-slim");
    });

    it("emits ENV lines for build args, quoted", () => {
        const df = generateDockerfile(
            { framework: "vite", package_manager: "pnpm", node_version: "22", build_context: "app" },
            { ...ctx, buildArgs: { VITE_API_URL: "https://example.com", FLAG: 'a"b' } },
        );
        expect(df).toContain('ENV VITE_API_URL="https://example.com"');
        expect(df).toContain('ENV FLAG="a\\"b"');
    });

    it("honors command overrides verbatim", () => {
        const df = generateDockerfile(
            {
                framework: "node",
                package_manager: "pnpm",
                node_version: "22",
                build_context: "app",
                install_command: "pnpm install --offline",
                build_command: "pnpm nx build web",
                run_command: "node dist/main.js",
            },
            ctx,
        );
        expect(df).toContain("RUN pnpm install --offline");
        expect(df).toContain("RUN pnpm nx build web");
        expect(df).toContain("CMD node dist/main.js");
        expect(df).not.toContain("pnpm run build");
    });
});
