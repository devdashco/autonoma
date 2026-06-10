import { execFileSync } from "node:child_process";
import * as k8s from "@kubernetes/client-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BuildError } from "../../src/builder/builder";
import { BuildKitJobManager } from "../../src/builder/buildkit-job-manager";

// Dedicated, disposable kind cluster. Reused across runs if it already exists;
// never deleted by the suite (faster reruns - `kind delete cluster --name
// previewkit-readiness` to remove it).
const CLUSTER_NAME = "previewkit-readiness";
const NAMESPACE = "buildkit-test";

function kind(args: string[]): string {
    return execFileSync("kind", args, { encoding: "utf8" });
}

/** k8s create-* calls that race with a previous run's leftovers throw 409;
 *  treat "already exists" as success and rethrow anything else. */
async function ignoreConflict(promise: Promise<unknown>): Promise<void> {
    try {
        await promise;
    } catch (err) {
        if (err instanceof k8s.ApiException && err.code === 409) return;
        throw err;
    }
}

let kc: k8s.KubeConfig;
let coreApi: k8s.CoreV1Api;
let batchApi: k8s.BatchV1Api;

beforeAll(async () => {
    const existing = kind(["get", "clusters"])
        .split("\n")
        .map((l) => l.trim());
    if (!existing.includes(CLUSTER_NAME)) {
        kind(["create", "cluster", "--name", CLUSTER_NAME, "--wait", "90s"]);
    }

    kc = new k8s.KubeConfig();
    kc.loadFromString(kind(["get", "kubeconfig", "--name", CLUSTER_NAME]));

    // SAFETY GATE: this suite creates Jobs/Pods, so it must NEVER run against a
    // real cluster (e.g. the ambient "agentic production" context). Hard-fail
    // unless the resolved kubeconfig is unmistakably a local kind cluster.
    const context = kc.getCurrentContext();
    const server = kc.getCurrentCluster()?.server ?? "";
    const isKindContext = context.startsWith("kind-");
    const isLocalServer = /^https?:\/\/(127\.0\.0\.1|0\.0\.0\.0|localhost)(:|\/|$)/.test(server);
    if (!isKindContext || !isLocalServer) {
        throw new Error(
            `Refusing to run kind tests: resolved context "${context}" / server "${server}" is not a local kind cluster`,
        );
    }

    coreApi = kc.makeApiClient(k8s.CoreV1Api);
    batchApi = kc.makeApiClient(k8s.BatchV1Api);

    // The manager's pod spec references a ServiceAccount and the buildkitd-config
    // ConfigMap; create them (and the namespace) so pod admission succeeds and
    // the pod reaches the scheduler.
    await ignoreConflict(coreApi.createNamespace({ body: { metadata: { name: NAMESPACE } } }));
    await ignoreConflict(
        coreApi.createNamespacedServiceAccount({ namespace: NAMESPACE, body: { metadata: { name: "buildkitd" } } }),
    );
    await ignoreConflict(
        coreApi.createNamespacedConfigMap({
            namespace: NAMESPACE,
            body: { metadata: { name: "buildkitd-config" }, data: { "buildkitd.toml": "" } },
        }),
    );
});

afterAll(async () => {
    // Drop the namespace (cascades Jobs/Pods/Services). Leave the cluster.
    await coreApi?.deleteNamespace({ name: NAMESPACE }).catch((err) => {
        console.warn("kind test: failed to delete namespace", err);
    });
});

describe("BuildKitJobManager against a real kind apiserver", () => {
    // The production Job pins `nodeSelector: { kubernetes.io/arch: amd64, pool:
    // buildkit }`. A kind cluster has neither label, so the build pod stays
    // Pending with PodScheduled=False forever - the exact "Karpenter cannot get
    // a node" shape the provision budget exists to bound. This validates, against
    // a real apiserver, that we read the PodScheduled condition correctly and that
    // the provision phase (not startup) is what surfaces the timeout.
    it("provision phase: an unschedulable build pod times out as a transient provisioning error", async () => {
        const mgr = new BuildKitJobManager({
            kc,
            namespace: NAMESPACE,
            image: "moby/buildkit:v0.21.1",
            serviceAccountName: "buildkitd",
            activeDeadlineSeconds: 600,
            // Short provision budget so the test resolves quickly; a generous
            // startup budget proves the timeout came from the provision phase.
            provisionTimeoutMs: 8_000,
            startupTimeoutMs: 120_000,
            // The pod never becomes Ready, so the post-Ready dial is never reached;
            // stub it anyway so a real socket is never opened.
            dial: async () => {},
        });

        const err = await mgr
            .provision()
            .then(() => undefined)
            .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(BuildError);
        if (!(err instanceof BuildError)) throw err;
        expect(err.message).toMatch(/scheduled onto a node \(provisioning\)/);
        expect(err.isTransient).toBe(true);

        // No Job leaked: provision() deletes the Job it created on failure.
        // Deletion is Background-propagated, so poll briefly for GC to settle.
        await expect
            .poll(async () => (await batchApi.listNamespacedJob({ namespace: NAMESPACE })).items.length)
            .toBe(0);
    });
});
