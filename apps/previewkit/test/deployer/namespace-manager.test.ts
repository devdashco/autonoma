import type * as k8s from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";
import { type GatekeeperRoute, NamespaceManager } from "../../src/deployer/namespace-manager";

// buildNamespaceName is a pure function; the constructor wires a CoreV1Api
// client we never call here. A no-op `makeApiClient` is enough to let the
// constructor succeed.
const stubKubeConfig = { makeApiClient: () => ({}) } as unknown as k8s.KubeConfig;
const manager = new NamespaceManager(stubKubeConfig);

describe("NamespaceManager.buildNamespaceName", () => {
    it("lowercases simple owner/repo names", () => {
        expect(manager.buildNamespaceName("acme/web", 42)).toBe("preview-acme-web-pr-42");
    });

    it("lowercases mixed-case owners before sanitizing (regression: case-sensitive sanitize ate uppercase chars)", () => {
        // Reproduces the bug where the sanitize regex ran case-sensitive, so
        // every uppercase letter was replaced with a hyphen — e.g.
        // `BigCorp/some-repo` would have become `preview--ig-orp-some-repo-...`.
        expect(manager.buildNamespaceName("BigCorp/some-repo", 1516)).toBe("preview-bigcorp-some-repo-pr-1516");
    });

    it("preserves multi-segment repo names", () => {
        expect(manager.buildNamespaceName("acme-corp/multi-word-repo-name", 7)).toBe(
            "preview-acme-corp-multi-word-repo-name-pr-7",
        );
    });

    it("replaces all non-alphanumerics (dots, underscores, slashes) with hyphens", () => {
        expect(manager.buildNamespaceName("acme.io/foo_bar.baz", 1)).toBe("preview-acme-io-foo-bar-baz-pr-1");
    });

    it("collapses consecutive hyphens", () => {
        expect(manager.buildNamespaceName("a---b//c", 1)).toBe("preview-a-b-c-pr-1");
    });

    it("trims leading and trailing hyphens before assembling", () => {
        // `-foo/bar-` would have left a leading `--` after the `preview-` prefix
        // without the trim step.
        expect(manager.buildNamespaceName("-foo/bar-", 9)).toBe("preview-foo-bar-pr-9");
    });

    it("truncates to 63 characters (Kubernetes DNS label limit)", () => {
        const result = manager.buildNamespaceName("acme-corporation-of-america/very-long-repository-name", 12345);
        expect(result.length).toBeLessThanOrEqual(63);
        expect(result.startsWith("preview-acme-corporation-of-america-very-long-repository-name")).toBe(true);
    });

    it("strips a trailing hyphen left by a mid-segment truncation", () => {
        // Pick a length that would slice exactly at a hyphen boundary if not
        // for the trailing-hyphen cleanup pass.
        const result = manager.buildNamespaceName("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbb/ccc", 7);
        expect(result.length).toBeLessThanOrEqual(63);
        expect(result.endsWith("-")).toBe(false);
    });

    it("produces a stable name for the same input (idempotent)", () => {
        const first = manager.buildNamespaceName("acme/web", 99);
        const second = manager.buildNamespaceName("acme/web", 99);
        expect(first).toBe(second);
    });

    it("output is always a valid RFC 1123 DNS label", () => {
        const dnsLabelRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
        const cases: Array<[string, number]> = [
            ["acme/web", 1],
            ["BigCorp/some-repo", 1516],
            ["acme.io/foo_bar.baz", 1],
            ["a---b//c", 1],
            ["UPPER/CASE", 42],
            ["acme-corporation-of-america/very-long-repository-name", 12345],
        ];

        for (const [repo, pr] of cases) {
            const name = manager.buildNamespaceName(repo, pr);
            expect(name).toMatch(dnsLabelRegex);
            expect(name.length).toBeLessThanOrEqual(63);
        }
    });
});

// Fake CoreV1Api capturing the replaceNamespace body, seeded with an existing
// namespace object the way readNamespace would return it.
function managerWithNamespace(existing: k8s.V1Namespace): {
    manager: NamespaceManager;
    replaced: () => k8s.V1Namespace | undefined;
} {
    let replacedBody: k8s.V1Namespace | undefined;
    const fakeCore = {
        readNamespace: () => Promise.resolve(structuredClone(existing)),
        replaceNamespace: ({ body }: { name: string; body: k8s.V1Namespace }) => {
            replacedBody = body;
            return Promise.resolve(body);
        },
    };
    const kc = { makeApiClient: () => fakeCore } as unknown as k8s.KubeConfig;
    return { manager: new NamespaceManager(kc), replaced: () => replacedBody };
}

describe("NamespaceManager.ensureGatekeeperManagement", () => {
    const routes: Record<string, GatekeeperRoute> = {
        "abc123def456.preview.autonoma.app": { service: "web", port: 3000 },
        "fed654cba321.preview.autonoma.app": { service: "api", port: 4000 },
    };

    it("labels the namespace for discovery and writes routes + idle-timeout annotations", async () => {
        const { manager, replaced } = managerWithNamespace({
            metadata: { name: "preview-acme-web-pr-42" },
        });

        await manager.ensureGatekeeperManagement("preview-acme-web-pr-42", routes, "45m");

        const ns = replaced();
        expect(ns?.metadata?.labels?.["gatekeeper.dev/managed"]).toBe("true");
        expect(ns?.metadata?.annotations?.["gatekeeper.dev/idle-timeout"]).toBe("45m");
        const written: unknown = JSON.parse(ns?.metadata?.annotations?.["gatekeeper.dev/routes"] ?? "{}");
        expect(written).toEqual(routes);
    });

    it("preserves existing labels and annotations (previewkit status metadata lives there too)", async () => {
        const { manager, replaced } = managerWithNamespace({
            metadata: {
                name: "preview-acme-web-pr-42",
                labels: { "previewkit.dev/managed-by": "previewkit", "previewkit.dev/pr-number": "42" },
                annotations: {
                    "previewkit.dev/status": "deploying",
                    // A previous deploy's routes: must be overwritten, not merged.
                    "gatekeeper.dev/routes": JSON.stringify({ "old.host": { service: "gone", port: 1 } }),
                },
            },
        });

        await manager.ensureGatekeeperManagement("preview-acme-web-pr-42", routes, "30m");

        const ns = replaced();
        expect(ns?.metadata?.labels?.["previewkit.dev/managed-by"]).toBe("previewkit");
        expect(ns?.metadata?.labels?.["previewkit.dev/pr-number"]).toBe("42");
        expect(ns?.metadata?.labels?.["gatekeeper.dev/managed"]).toBe("true");
        expect(ns?.metadata?.annotations?.["previewkit.dev/status"]).toBe("deploying");
        const written: unknown = JSON.parse(ns?.metadata?.annotations?.["gatekeeper.dev/routes"] ?? "{}");
        expect(written).toEqual(routes);
    });
});
