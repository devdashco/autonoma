import type { V1ContainerStatus, V1Pod } from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";
import { findTerminalPodFailure, summarizePodStates } from "../../src/deployer/pod-failure";

function container(state: V1ContainerStatus["state"]): V1ContainerStatus {
    return { name: "app", ready: false, restartCount: 0, image: "img", imageID: "", state };
}

function waitingPod(reason: string, message?: string): V1Pod {
    const waiting = message != null ? { reason, message } : { reason };
    return { metadata: { name: "pod-1" }, status: { phase: "Pending", containerStatuses: [container({ waiting })] } };
}

describe("findTerminalPodFailure", () => {
    it("flags terminal waiting reasons with the pod, container, and kubelet message", () => {
        const reason = findTerminalPodFailure([waitingPod("ImagePullBackOff", "manifest unknown")]);
        expect(reason).toContain("pod-1");
        expect(reason).toContain("app");
        expect(reason).toContain("ImagePullBackOff");
        expect(reason).toContain("manifest unknown");
    });

    it.each([
        "CrashLoopBackOff",
        "ImagePullBackOff",
        "InvalidImageName",
        "CreateContainerConfigError",
        "CreateContainerError",
    ])("treats %s as terminal", (reason) => {
        expect(findTerminalPodFailure([waitingPod(reason)])).toBeDefined();
    });

    it("preserves the literal CrashLoopBackOff token so downstream recovery still triggers", () => {
        // tryDeployApp classifies via message.includes("CrashLoopBackOff").
        expect(findTerminalPodFailure([waitingPod("CrashLoopBackOff")])).toContain("CrashLoopBackOff");
    });

    it("does NOT fail on a first-attempt ErrImagePull (kubelet may still succeed on retry)", () => {
        expect(findTerminalPodFailure([waitingPod("ErrImagePull")])).toBeUndefined();
    });

    it("does NOT fail on pods still legitimately progressing toward Ready", () => {
        expect(findTerminalPodFailure([waitingPod("ContainerCreating")])).toBeUndefined();
        expect(findTerminalPodFailure([waitingPod("PodInitializing")])).toBeUndefined();
    });

    it("does NOT fail on an unschedulable Pending pod (Karpenter may still provision a node)", () => {
        const pod: V1Pod = {
            metadata: { name: "pod-1" },
            status: {
                phase: "Pending",
                conditions: [
                    { type: "PodScheduled", status: "False", reason: "Unschedulable", message: "insufficient cpu" },
                ],
                containerStatuses: [],
            },
        };
        expect(findTerminalPodFailure([pod])).toBeUndefined();
    });

    it("does NOT fail on a running/ready pod", () => {
        const pod: V1Pod = {
            metadata: { name: "pod-1" },
            status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [container({ running: {} })],
            },
        };
        expect(findTerminalPodFailure([pod])).toBeUndefined();
    });

    it("returns undefined for no pods", () => {
        expect(findTerminalPodFailure([])).toBeUndefined();
    });

    it("returns the first terminal pod when several pods are present", () => {
        const healthy: V1Pod = {
            metadata: { name: "ok" },
            status: { containerStatuses: [container({ running: {} })] },
        };
        const reason = findTerminalPodFailure([healthy, waitingPod("CrashLoopBackOff")]);
        expect(reason).toContain("CrashLoopBackOff");
    });
});

describe("summarizePodStates", () => {
    it("reports when there are no pods", () => {
        expect(summarizePodStates([])).toBe("no pods found");
    });

    it("includes phase and container waiting reason", () => {
        const summary = summarizePodStates([waitingPod("ImagePullBackOff")]);
        expect(summary).toContain("pod-1 (Pending)");
        expect(summary).toContain("app:ImagePullBackOff");
    });

    it("includes a terminated reason with its exit code", () => {
        const pod: V1Pod = {
            metadata: { name: "pod-1" },
            status: {
                phase: "Running",
                containerStatuses: [container({ terminated: { reason: "OOMKilled", exitCode: 137 } })],
            },
        };
        expect(summarizePodStates([pod])).toContain("app:OOMKilled(exit 137)");
    });

    it("includes an unschedulable message", () => {
        const pod: V1Pod = {
            metadata: { name: "pod-1" },
            status: {
                phase: "Pending",
                conditions: [{ type: "PodScheduled", status: "False", message: "insufficient cpu" }],
            },
        };
        expect(summarizePodStates([pod])).toContain("unschedulable=insufficient cpu");
    });
});
