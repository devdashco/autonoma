import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import * as k8s from "@kubernetes/client-node";
import { isNotFound } from "../deployer/k8s-errors";
import { logger as rootLogger, type Logger } from "../logger";
import { BuildError } from "./builder";

const NAME_PREFIX = "pk-builder";
const LABEL_MANAGED_BY = "previewkit.dev/managed-by";
const LABEL_TYPE = "previewkit.dev/type";
const LABEL_BUILD_ID = "previewkit.dev/build-id";
const BUILDKIT_PORT = 1234;
const BUILD_ID_BYTES = 8;
const BUILD_NODE_POOL = "buildkit";
const BUILDKITD_CONFIG_CONFIGMAP = "buildkitd-config";
const BUILDKITD_CONFIG_VOLUME = "buildkitd-config";
const BUILDKITD_CONFIG_MOUNT_PATH = "/etc/buildkit";
const BUILDKITD_CONFIG_FILE = "/etc/buildkit/buildkitd.toml";
const READINESS_POLL_INTERVAL_MS = 500;
const DEFAULT_PROVISION_TIMEOUT_MS = 600_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 180_000;
const DIAL_TIMEOUT_MS = 2_000;
const DIAL_RETRY_BUDGET_MS = 30_000;
const DIAL_RETRY_INTERVAL_MS = 500;
const TTL_SECONDS_AFTER_FINISHED = 600;

interface BuildKitJobManagerOptions {
    kc: k8s.KubeConfig;
    /** Namespace where buildkit Jobs are created. Should be dedicated so RBAC
     *  / quotas / NetworkPolicies can target it cleanly. */
    namespace: string;
    /** Image with the buildkitd daemon. */
    image: string;
    /** ServiceAccount the build pods run as. Must exist in `namespace` and
     *  carry the IRSA annotation for S3 cache access. */
    serviceAccountName: string;
    /** Hard upper bound on a single Job (seconds). Passed straight to
     *  Job.spec.activeDeadlineSeconds so K8s self-terminates stuck builds
     *  even if previewkit crashed before calling release(). */
    activeDeadlineSeconds: number;
    /** How long to wait for the build pod to be scheduled onto a node
     *  (PodScheduled=True) before treating the attempt as a (transient)
     *  failure. This bounds pure infra latency - Karpenter launching and
     *  registering a fresh pool=buildkit node - so it is set generously.
     *  Defaults to DEFAULT_PROVISION_TIMEOUT_MS; production wires it from
     *  BUILD_READINESS_TIMEOUT_MS so it can outlast a cold spot scale-up. */
    provisionTimeoutMs?: number;
    /** How long to wait, once the pod is scheduled, for it to report Ready
     *  (image pull + container start + buildkitd boot) before treating the
     *  attempt as a (transient) failure. A scheduled-but-never-Ready pod is a
     *  real "the service is broken" signal, so this is tighter than the
     *  provision budget. Defaults to DEFAULT_STARTUP_TIMEOUT_MS; production
     *  wires it from BUILD_STARTUP_TIMEOUT_MS. */
    startupTimeoutMs?: number;
    /** Override the TCP dial probe used after Pod becomes Ready. Production
     *  uses the default (node:net createConnection); tests inject a fake
     *  that resolves without doing real I/O. */
    dial?: (host: string, port: number, timeoutMs: number) => Promise<void>;
}

export interface BuildKitInstance {
    /** K8s resource name. Same value for the Job and Service. */
    name: string;
    /** Random 16-hex-char id encoded into `name`; also the value of the
     *  `previewkit.dev/build-id` label used by the Service selector. */
    buildId: string;
    /** Stable in-cluster DNS endpoint:
     *  `tcp://<name>.<namespace>.svc.cluster.local:1234`. Hand this to
     *  buildctl as `--addr`. */
    host: string;
}

/**
 * Spawns one ephemeral buildkitd per app build (as a K8s Job) and tears it
 * down on release. The Service alongside the Job gives buildctl a stable
 * DNS name to dial; the Job's ownerReference on the Service makes K8s GC
 * cascade so a single delete-job call cleans up both.
 *
 * Lives in the previewkit control cluster (the same cluster previewkit
 * itself runs in). Client preview workloads run in a separate cluster -
 * builds don't share node resources with running previews anymore.
 */
export class BuildKitJobManager {
    private readonly batchApi: k8s.BatchV1Api;
    private readonly coreApi: k8s.CoreV1Api;
    private readonly logger: Logger;
    private readonly dial: (host: string, port: number, timeoutMs: number) => Promise<void>;

    constructor(private readonly options: BuildKitJobManagerOptions) {
        this.batchApi = options.kc.makeApiClient(k8s.BatchV1Api);
        this.coreApi = options.kc.makeApiClient(k8s.CoreV1Api);
        this.logger = rootLogger.child({ name: this.constructor.name });
        this.dial = options.dial ?? tryConnect;
    }

    /**
     * Creates the Job + Service, waits for the pod to be Ready, returns the
     * connection info. On any failure during this sequence the partial state
     * is cleaned up before throwing - callers can treat a thrown provision()
     * as "no resources leaked".
     */
    async provision(): Promise<BuildKitInstance> {
        const buildId = randomBytes(BUILD_ID_BYTES).toString("hex");
        const name = `${NAME_PREFIX}-${buildId}`;
        const namespace = this.options.namespace;

        this.logger.info("Provisioning buildkit Job", { name, namespace });

        const createdJob = await this.batchApi.createNamespacedJob({
            namespace,
            body: this.jobSpec(name, buildId),
        });

        try {
            await this.coreApi.createNamespacedService({
                namespace,
                body: this.serviceSpec(name, buildId, createdJob),
            });

            await this.waitForReady(buildId);

            // Pod.status.Ready trips when kubelet's TCP probe succeeds from
            // inside the pod's net namespace - but there's a separate lag
            // before the endpoints controller wires the pod into the Service
            // backends and kube-proxy programs its iptables. Hand control to
            // buildctl during that window and the first dial gets RST'd.
            // Probe with a real TCP connect from this pod before returning.
            const dnsName = `${name}.${namespace}.svc.cluster.local`;
            await this.waitForTcpReachable(dnsName);

            const host = `tcp://${dnsName}:${BUILDKIT_PORT}`;
            this.logger.info("Buildkit Job ready", { name, host });
            return { name, buildId, host };
        } catch (err) {
            await this.release({ name }).catch((cleanupErr) => {
                this.logger.warn("Cleanup after failed provision also failed", { name, cleanupErr });
            });
            throw err;
        }
    }

    /**
     * Deletes the Job. The Service is GC'd automatically via its
     * ownerReference. Idempotent - silent on NotFound so callers in `finally`
     * blocks don't have to special-case repeated cleanup.
     */
    async release(instance: { name: string }): Promise<void> {
        const { namespace } = this.options;
        this.logger.info("Releasing buildkit Job", { name: instance.name, namespace });

        try {
            await this.batchApi.deleteNamespacedJob({
                name: instance.name,
                namespace,
                propagationPolicy: "Background",
            });
        } catch (err) {
            if (isNotFound(err)) return;
            throw err;
        }
    }

    /**
     * Real TCP dial against the Service hostname, retrying on ECONNREFUSED /
     * timeout / DNS failures until kube-proxy has wired the new pod into
     * iptables. Returns void on the first successful connect; throws a
     * transient BuildError after `DIAL_RETRY_BUDGET_MS` so the retry loop in
     * BuildKitBuilder picks it up and tries a fresh Job.
     *
     * Without this, `Pod.status.Ready` says "yes, kubelet's loopback probe
     * succeeded" before the endpoints controller and kube-proxy finish their
     * own propagation, and buildctl gets `connection refused` on its first
     * attempt against an IP that resolves but has no backend yet.
     */
    private async waitForTcpReachable(host: string): Promise<void> {
        const deadline = Date.now() + DIAL_RETRY_BUDGET_MS;
        let attempts = 0;
        let lastErr: Error | undefined;
        while (Date.now() < deadline) {
            attempts++;
            try {
                await this.dial(host, BUILDKIT_PORT, DIAL_TIMEOUT_MS);
                if (attempts > 1) {
                    this.logger.info("buildkit Service became reachable", { host, attempts });
                }
                return;
            } catch (err) {
                lastErr = err instanceof Error ? err : new Error(String(err));
                await new Promise<void>((res) => setTimeout(res, DIAL_RETRY_INTERVAL_MS));
            }
        }
        throw new BuildError(
            `buildkit Service ${host}:${BUILDKIT_PORT} did not accept connections within ${DIAL_RETRY_BUDGET_MS}ms (${attempts} attempts, last error: ${lastErr?.message ?? "unknown"})`,
            { isTransient: true, cause: lastErr },
        );
    }

    /**
     * Two physically unrelated waits, split into two independently-budgeted
     * phases keyed on the PodScheduled condition (NOT pod.status.phase, which
     * conflates "not scheduled yet" with "scheduled but not Ready"):
     *
     *   1. provision - Job created -> PodScheduled=True. Bounds Karpenter
     *      bringing a fresh pool=buildkit node online (pure infra latency).
     *   2. startup   - PodScheduled=True -> Ready=True. Bounds image pull +
     *      container start + buildkitd boot (a real "service is broken" signal).
     *
     * classifyPodFailure runs every tick in BOTH phases, so genuine failures
     * (ImagePullBackOff / Evicted / OOMKilled) still fast-fail before either
     * budget elapses.
     */
    private async waitForReady(buildId: string): Promise<void> {
        await this.waitForScheduled(buildId);
        await this.waitForStarted(buildId);
    }

    /**
     * Provision phase. Polls until the build pod reports PodScheduled=True,
     * fast-failing on a classified pod failure. Throws a transient BuildError
     * naming the provisioning phase when the provision budget is exhausted -
     * "the buildkit pool cannot get a node" (capacity / quota bound). Transient
     * because a retry may land capacity.
     */
    private async waitForScheduled(buildId: string): Promise<void> {
        const start = Date.now();
        const { namespace } = this.options;
        const selector = `${LABEL_BUILD_ID}=${buildId}`;
        const provisionTimeoutMs = this.options.provisionTimeoutMs ?? DEFAULT_PROVISION_TIMEOUT_MS;

        while (Date.now() - start < provisionTimeoutMs) {
            const pods = await this.coreApi.listNamespacedPod({ namespace, labelSelector: selector });
            const pod = pods.items[0];

            if (pod != null) {
                const failure = classifyPodFailure(pod);
                if (failure != null) {
                    throw new BuildError(failure.message, { isTransient: failure.transient });
                }

                if (isScheduled(pod)) {
                    this.logger.info("buildkit Job scheduled onto a node", {
                        buildId,
                        provisioningMs: Date.now() - start,
                    });
                    return;
                }
            }

            await new Promise<void>((res) => setTimeout(res, READINESS_POLL_INTERVAL_MS));
        }

        const elapsedMs = Date.now() - start;
        this.logger.warn("buildkit Job provisioning timed out", { buildId, phase: "provisioning", elapsedMs });
        throw new BuildError(
            `Timed out after ${provisionTimeoutMs}ms waiting for buildkit Job (build-id=${buildId}) to be scheduled onto a node (provisioning)`,
            { isTransient: true },
        );
    }

    /**
     * Startup phase. The pod is scheduled; poll until it reports Ready=True,
     * fast-failing on a classified pod failure. Throws a transient BuildError
     * naming the startup phase when the startup budget is exhausted - "the node
     * is up but buildkitd is not becoming Ready."
     *
     * Spot-reclaim edge case: a scheduled pod can be evicted and bounce back to
     * unscheduled mid-startup. We deliberately do NOT loop back to the provision
     * phase within one call - classifyPodFailure returns transient for Evicted,
     * so this loop throws transient and the builder retries with a fresh
     * provision(). No re-provision state machine.
     */
    private async waitForStarted(buildId: string): Promise<void> {
        const start = Date.now();
        const { namespace } = this.options;
        const selector = `${LABEL_BUILD_ID}=${buildId}`;
        const startupTimeoutMs = this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

        while (Date.now() - start < startupTimeoutMs) {
            const pods = await this.coreApi.listNamespacedPod({ namespace, labelSelector: selector });
            const pod = pods.items[0];

            if (pod != null) {
                const failure = classifyPodFailure(pod);
                if (failure != null) {
                    throw new BuildError(failure.message, { isTransient: failure.transient });
                }

                const ready = pod.status?.conditions?.find((c) => c.type === "Ready");
                if (ready?.status === "True") return;
            }

            await new Promise<void>((res) => setTimeout(res, READINESS_POLL_INTERVAL_MS));
        }

        const elapsedMs = Date.now() - start;
        this.logger.warn("buildkit Job startup timed out", { buildId, phase: "startup", elapsedMs });
        throw new BuildError(
            `Timed out after ${startupTimeoutMs}ms waiting for scheduled buildkit Job (build-id=${buildId}) to become Ready (startup)`,
            { isTransient: true },
        );
    }

    private jobSpec(name: string, buildId: string): k8s.V1Job {
        const labels = {
            [LABEL_MANAGED_BY]: "previewkit",
            [LABEL_TYPE]: "build",
            [LABEL_BUILD_ID]: buildId,
        };
        return {
            apiVersion: "batch/v1",
            kind: "Job",
            metadata: { name, labels },
            spec: {
                backoffLimit: 0,
                activeDeadlineSeconds: this.options.activeDeadlineSeconds,
                ttlSecondsAfterFinished: TTL_SECONDS_AFTER_FINISHED,
                template: {
                    metadata: { labels },
                    spec: {
                        restartPolicy: "Never",
                        serviceAccountName: this.options.serviceAccountName,
                        nodeSelector: {
                            "kubernetes.io/arch": "amd64",
                            pool: BUILD_NODE_POOL,
                        },
                        tolerations: [{ key: "pool", operator: "Equal", value: BUILD_NODE_POOL, effect: "NoSchedule" }],
                        affinity: {
                            podAntiAffinity: {
                                // Soft preference - the scheduler tries to put
                                // one build pod per node so heavy builds don't
                                // contend, but won't refuse to schedule when
                                // every node already has one (burst load).
                                preferredDuringSchedulingIgnoredDuringExecution: [
                                    {
                                        weight: 100,
                                        podAffinityTerm: {
                                            labelSelector: { matchLabels: { [LABEL_TYPE]: "build" } },
                                            topologyKey: "kubernetes.io/hostname",
                                        },
                                    },
                                ],
                            },
                        },
                        containers: [
                            {
                                name: "buildkitd",
                                image: this.options.image,
                                args: ["--addr", `tcp://0.0.0.0:${BUILDKIT_PORT}`, "--config", BUILDKITD_CONFIG_FILE],
                                ports: [{ containerPort: BUILDKIT_PORT, name: "buildkit" }],
                                // Privileged is required for buildkitd's overlayfs
                                // worker on a stock kernel. Rootless mode is a v2
                                // hardening; for v1 we accept the same posture as
                                // the previous long-lived buildkitd Deployment.
                                securityContext: { privileged: true },
                                readinessProbe: {
                                    tcpSocket: { port: BUILDKIT_PORT },
                                    initialDelaySeconds: 2,
                                    periodSeconds: 1,
                                    failureThreshold: 30,
                                },
                                resources: {
                                    requests: { cpu: "4", memory: "8Gi" },
                                },
                                volumeMounts: [
                                    {
                                        name: BUILDKITD_CONFIG_VOLUME,
                                        mountPath: BUILDKITD_CONFIG_MOUNT_PATH,
                                        readOnly: true,
                                    },
                                ],
                            },
                        ],
                        volumes: [
                            {
                                name: BUILDKITD_CONFIG_VOLUME,
                                configMap: { name: BUILDKITD_CONFIG_CONFIGMAP },
                            },
                        ],
                    },
                },
            },
        };
    }

    private serviceSpec(name: string, buildId: string, job: k8s.V1Job): k8s.V1Service {
        const uid = job.metadata?.uid;
        if (uid == null) {
            throw new Error(`Job ${name} has no metadata.uid - cannot set ownerReference on the Service`);
        }
        return {
            apiVersion: "v1",
            kind: "Service",
            metadata: {
                name,
                labels: {
                    [LABEL_MANAGED_BY]: "previewkit",
                    [LABEL_TYPE]: "build",
                    [LABEL_BUILD_ID]: buildId,
                },
                // Tying the Service's lifetime to the Job: when the Job is
                // deleted (or its TTL kicks in), K8s GC removes the Service
                // too. One delete-job call handles both resources.
                ownerReferences: [
                    {
                        apiVersion: "batch/v1",
                        kind: "Job",
                        name,
                        uid,
                        controller: true,
                        blockOwnerDeletion: true,
                    },
                ],
            },
            spec: {
                selector: { [LABEL_BUILD_ID]: buildId },
                ports: [{ port: BUILDKIT_PORT, targetPort: BUILDKIT_PORT, name: "buildkit" }],
            },
        };
    }
}

/**
 * One TCP connect attempt with a hard timeout. Resolves on `connect`, rejects
 * on socket error or when the timeout fires first. The socket is always
 * destroyed before resolving / rejecting so we don't leak FDs across retries.
 */
function tryConnect(host: string, port: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = createConnection({ host, port });
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`dial ${host}:${port} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        socket.once("connect", () => {
            clearTimeout(timer);
            socket.end();
            resolve();
        });
        socket.once("error", (err) => {
            clearTimeout(timer);
            socket.destroy();
            reject(err);
        });
    });
}

/**
 * The provision/startup phase boundary: true once the scheduler has bound the
 * pod to a node. Keyed on the PodScheduled condition rather than pod.status.phase
 * so "Pending, unscheduled" and "Pending, scheduled but not Ready" are
 * distinguishable.
 */
function isScheduled(pod: k8s.V1Pod): boolean {
    return pod.status?.conditions?.some((c) => c.type === "PodScheduled" && c.status === "True") ?? false;
}

interface PodFailure {
    message: string;
    /** True if the right move is to provision a fresh Job and retry (e.g.
     *  node-pressure eviction, spot interruption). False for config errors
     *  that would just repeat (bad image, container crash loop). */
    transient: boolean;
}

/**
 * Container `state.waiting.reason` values that mean the pod will never reach
 * Ready without a config change, so retrying just burns budget. CrashLoopBackOff
 * is kept defensively (it needs restartPolicy Always/OnFailure, which this Job
 * does NOT use - see classifyPodFailure - but a future spec change might).
 */
const PERMANENT_WAITING_REASONS = new Set([
    "ImagePullBackOff",
    "ErrImagePull",
    "InvalidImageName",
    "CreateContainerConfigError",
    "CreateContainerError",
    "CrashLoopBackOff",
]);

/**
 * Container `state.terminated.reason` values that mean the container could not
 * start at all (bad command, missing binary, privilege denied) - a permanent
 * config / privilege problem, never a transient node signal.
 */
const PERMANENT_TERMINATED_REASONS = new Set(["StartError", "ContainerCannotRun"]);

/**
 * Reads pod status and returns a structured failure for callers to surface
 * (or null if the pod is still progressing toward Ready). Distinguishes:
 *
 *   - Pod-level Failed phase with reason="Evicted" → transient. Node ran
 *     out of CPU/memory/disk and kubelet killed the pod; another node has
 *     a real chance of accepting it.
 *   - Container terminated with OOMKilled → transient. Sometimes a noisy
 *     neighbour or a hot start; the next attempt may find a quieter node.
 *     Operators tune resource requests if it recurs.
 *   - Container terminated with StartError / ContainerCannotRun → permanent.
 *     This Job runs restartPolicy=Never + backoffLimit=0, so a buildkitd that
 *     fails to start terminates ONCE and never enters CrashLoopBackOff (which
 *     needs a restarting policy). A terminated start-failure is the real
 *     "buildkitd won't come up" signal and a retry won't fix it.
 *   - Container waiting in a PERMANENT_WAITING_REASON (bad image, bad config /
 *     ConfigMap mount, ...) → permanent. Retrying just burns retry budget.
 *
 * A plain non-zero exit (terminated reason "Error") is deliberately NOT
 * classified here: it is ambiguous between a deterministic buildkitd failure
 * and a spot-reclaim SIGTERM mid-startup (which we want retried). The startup
 * budget bounds it and surfaces it as a transient startup timeout.
 */
function classifyPodFailure(pod: k8s.V1Pod): PodFailure | null {
    const podName = pod.metadata?.name;

    if (pod.status?.phase === "Failed" && pod.status.reason === "Evicted") {
        return {
            transient: true,
            message: `Buildkit pod ${podName} was evicted: ${pod.status.message ?? "unknown reason"}`,
        };
    }

    for (const cs of pod.status?.containerStatuses ?? []) {
        const terminated = cs.state?.terminated;
        if (terminated?.reason === "OOMKilled") {
            return {
                transient: true,
                message: `Buildkit pod ${podName} OOMKilled (exit ${terminated.exitCode ?? "?"})`,
            };
        }
        if (terminated?.reason != null && PERMANENT_TERMINATED_REASONS.has(terminated.reason)) {
            return {
                transient: false,
                message: `Buildkit pod ${podName} failed to start (${terminated.reason}): ${terminated.message ?? ""}`,
            };
        }

        const waitingReason = cs.state?.waiting?.reason;
        if (waitingReason != null && PERMANENT_WAITING_REASONS.has(waitingReason)) {
            return {
                transient: false,
                message: `Buildkit pod ${podName} failed to start (${waitingReason}): ${cs.state?.waiting?.message ?? ""}`,
            };
        }
    }

    return null;
}
