import { BuildLogSpool } from "@autonoma/logger/build-log-spool";
import { S3Storage } from "@autonoma/storage";
import * as k8s from "@kubernetes/client-node";
import { AddonManager } from "./addons/addon-manager";
import { OrgSecretResolver } from "./addons/org-secret-resolver";
import { NeonProvider } from "./addons/providers/neon";
import { AddonProviderRegistry } from "./addons/registry";
import { BuildKitBuilder } from "./builder/buildkit-builder";
import { BuildKitJobManager } from "./builder/buildkit-job-manager";
import { createPreviewkitDefaults } from "./config";
import { Deployer } from "./deployer/deployer";
import { EksKubeconfigLoader } from "./deployer/eks-kubeconfig";
import { env } from "./env";
import { GitHubProvider } from "./git-provider/github-provider";
import { logger } from "./logger";
import { PreviewPipeline } from "./pipeline/preview-pipeline";
import { TeardownPipeline } from "./pipeline/teardown-pipeline";
import { connectRedis } from "./redis";
import { AwsExternalSecretManager } from "./secrets/aws-external-secret-manager";
import { AwsSecretsFetcher } from "./secrets/aws-secrets-fetcher";

/**
 * Everything the HTTP server and the Temporal worker both need. Both entry
 * points (`src/index.ts` and `src/worker/index.ts`) build the same object so
 * the deploy/teardown logic is constructed identically regardless of how it is
 * triggered (in-process webhook vs Temporal activity).
 */
export interface PreviewkitServices {
    previewPipeline: PreviewPipeline;
    teardownPipeline: TeardownPipeline;
    githubProvider: GitHubProvider;
}

export async function createPreviewkitServices(): Promise<PreviewkitServices> {
    // Kubernetes client for the preview (target) cluster.
    let kc: k8s.KubeConfig;
    if (env.EKS_CLUSTER_NAME != null) {
        if (env.AWS_REGION == null) {
            throw new Error("AWS_REGION is required when EKS_CLUSTER_NAME is set");
        }
        const staticClusterInfo =
            env.EKS_CLUSTER_ENDPOINT != null && env.EKS_CLUSTER_CA != null
                ? { endpoint: env.EKS_CLUSTER_ENDPOINT, caData: env.EKS_CLUSTER_CA }
                : undefined;
        const loader = new EksKubeconfigLoader(env.EKS_CLUSTER_NAME, env.AWS_REGION, staticClusterInfo);
        kc = await loader.load();
        // Refresh the token every 45 seconds (STS presigned URLs expire in 60s).
        // load() mutates the existing kc object in-place, so all API clients pick up the new token.
        setInterval(() => {
            loader.load().catch((err) => logger.error("Failed to refresh EKS kubeconfig token", err));
        }, 45_000);
    } else {
        kc = new k8s.KubeConfig();
        if (env.KUBECONFIG) {
            kc.loadFromFile(env.KUBECONFIG);
        } else {
            kc.loadFromDefault();
        }
    }

    // Local cluster kubeconfig (cluster A - same cluster previewkit itself
    // runs in). `kc` above points at the preview cluster (B) and is used by
    // the Deployer; `localKc` is used by the BuildKitJobManager to spawn
    // ephemeral buildkitd Jobs alongside previewkit.
    let localKc: k8s.KubeConfig;
    if (env.EKS_CLUSTER_NAME != null) {
        localKc = new k8s.KubeConfig();
        localKc.loadFromCluster();
    } else {
        localKc = kc;
    }

    // Git provider
    const githubProvider = new GitHubProvider({
        appId: env.GITHUB_APP_ID,
        privateKey: env.GITHUB_PRIVATE_KEY,
    });

    // Object storage for build logs. Reads S3_* env from @autonoma/storage/env.
    const storage = S3Storage.createFromEnv();

    // Live build-log streaming tier. When REDIS_URL is set, the builder mirrors
    // each output chunk and the pipeline mirrors phase/status transitions into a
    // per-namespace Redis Stream that the autonoma API relays to the browser
    // over SSE. Wired here so BOTH the HTTP server and the Temporal worker get
    // it. Streaming is non-critical (builds still log to disk + S3), so a missing
    // or unreachable Redis degrades to "disabled" rather than failing startup.
    const logSpool = await createBuildLogSpool();

    // Platform-owned defaults applied to every preview (registry, domain, build
    // timeout, standard resources). Single source of truth read below.
    const previewkitDefaults = createPreviewkitDefaults(env);

    // Per-build buildkitd lifecycle. The manager spins up an ephemeral Job +
    // Service per app build in cluster A, and the builder dials it via
    // in-cluster DNS.
    const buildkitJobManager = new BuildKitJobManager({
        kc: localKc,
        namespace: env.BUILDKIT_BUILD_NAMESPACE,
        image: env.BUILDKIT_IMAGE,
        serviceAccountName: env.BUILDKIT_BUILDER_SERVICE_ACCOUNT,
        activeDeadlineSeconds: Math.ceil(previewkitDefaults.defaults.buildTimeoutMs / 1000) + 60,
        provisionTimeoutMs: env.BUILD_READINESS_TIMEOUT_MS,
        startupTimeoutMs: env.BUILD_STARTUP_TIMEOUT_MS,
    });

    // Builder. The BuildKit layer cache shares the storage bucket with build logs;
    // each writes under a distinct top-level key prefix so they can coexist.
    const builder = new BuildKitBuilder({
        jobManager: buildkitJobManager,
        buildTimeoutMs: previewkitDefaults.defaults.buildTimeoutMs,
        storage,
        ...(logSpool != null ? { logSpool } : {}),
    });

    // AWS Secrets Manager -> K8s ExternalSecret bridge.
    const awsExternalSecretManager = new AwsExternalSecretManager(kc, env.CLUSTER_SECRET_STORE_NAME);

    // AWS Secrets Manager direct fetcher for build-time secrets.
    const awsSecretsFetcher = new AwsSecretsFetcher(env.S3_REGION);

    // Deployer
    const deployer = new Deployer(
        kc,
        previewkitDefaults.defaults.domain,
        env.PREVIEW_URL_SECRET,
        awsExternalSecretManager,
        env.NGINX_IMAGE,
        env.APP_URL,
        env.INGRESS_CLASS_NAME,
        env.INGRESS_NAMESPACE,
        env.DEPLOY_TIMEOUT_MS,
    );

    // Addon plugin registry + manager.
    const addonProviderRegistry = new AddonProviderRegistry();
    addonProviderRegistry.register(new NeonProvider());
    const orgSecretResolver = new OrgSecretResolver(awsSecretsFetcher);
    const addonManager = new AddonManager(addonProviderRegistry, orgSecretResolver);

    // Pipelines
    const previewPipeline = new PreviewPipeline({
        provider: githubProvider,
        builder,
        deployer,
        awsSecretsFetcher,
        addonManager,
        registryUrl: previewkitDefaults.defaults.registry,
        storage,
        ...(logSpool != null ? { logSpool } : {}),
    });

    const teardownPipeline = new TeardownPipeline({
        provider: githubProvider,
        deployer,
        addonManager,
    });

    return { previewPipeline, teardownPipeline, githubProvider };
}

/**
 * Builds the optional live build-log spool. Returns undefined - disabling
 * streaming - when REDIS_URL is unset or Redis is unreachable, so a Redis
 * outage can never take down the HTTP server or the Temporal worker (both call
 * createPreviewkitServices at startup). Builds always log to disk + S3.
 */
async function createBuildLogSpool(): Promise<BuildLogSpool | undefined> {
    if (env.REDIS_URL == null) {
        logger.warn("REDIS_URL not set - live build-log streaming is disabled");
        return undefined;
    }
    try {
        const redis = await connectRedis({ url: env.REDIS_URL });
        return new BuildLogSpool(redis);
    } catch (err) {
        logger.error("Failed to connect to Redis - live build-log streaming disabled", err);
        return undefined;
    }
}
