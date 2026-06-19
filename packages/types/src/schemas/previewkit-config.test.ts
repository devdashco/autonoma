import { describe, expect, it } from "vitest";
import { previewConfigSchema } from "./previewkit-config";

function parseWithBuild(build: unknown) {
    return previewConfigSchema.safeParse({
        version: 1,
        apps: [{ name: "web", port: 3000, build }],
    });
}

describe("previewConfigSchema build block", () => {
    it("defaults package_manager, node_version, and build_context for a node framework", () => {
        const result = parseWithBuild({ framework: "node" });
        expect(result.success).toBe(true);
        if (result.success) {
            const build = result.data.apps[0]?.build;
            expect(build).toEqual({
                framework: "node",
                package_manager: "pnpm",
                node_version: "22",
                build_context: "app",
            });
        }
    });

    it.each(["node", "next", "vite"])("accepts the %s framework", (framework) => {
        expect(parseWithBuild({ framework }).success).toBe(true);
    });

    it("accepts the bun framework without package_manager or node_version", () => {
        const result = parseWithBuild({ framework: "bun", build_context: "root" });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.apps[0]?.build).toEqual({ framework: "bun", build_context: "root" });
        }
    });

    it("accepts a dockerfile framework with a path", () => {
        expect(parseWithBuild({ framework: "dockerfile", dockerfile: "./Dockerfile" }).success).toBe(true);
    });

    it("rejects a dockerfile framework without a path", () => {
        expect(parseWithBuild({ framework: "dockerfile" }).success).toBe(false);
    });

    it("rejects an unknown framework", () => {
        expect(parseWithBuild({ framework: "svelte" }).success).toBe(false);
    });

    it("rejects an unknown package_manager", () => {
        expect(parseWithBuild({ framework: "node", package_manager: "bun" }).success).toBe(false);
    });

    it.each(["22", "22.5", "22.5.0"])("accepts node_version %s", (node_version) => {
        expect(parseWithBuild({ framework: "node", node_version }).success).toBe(true);
    });

    it.each(["latest", "v22", "22.x", ""])("rejects node_version %s", (node_version) => {
        expect(parseWithBuild({ framework: "node", node_version }).success).toBe(false);
    });

    it("rejects an invalid build_context", () => {
        expect(parseWithBuild({ framework: "node", build_context: "repo" }).success).toBe(false);
    });

    it("parses an app with no build block (Railpack fallback)", () => {
        const result = previewConfigSchema.safeParse({ version: 1, apps: [{ name: "web", port: 3000 }] });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.apps[0]?.build).toBeUndefined();
        }
    });
});
