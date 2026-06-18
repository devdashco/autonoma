import type { PrismaClient } from "@autonoma/db";
import type { EncryptionHelper } from "./encryption";

export interface SdkConfig {
    applicationId: string;
    sdkUrl: string;
    /** Plain signing secret - already decrypted from the stored encrypted value. */
    signingSecret: string;
    customHeaders?: Record<string, string>;
}

/**
 * Resolve the SDK endpoint config (URL, headers, decrypted signing secret) for
 * a given application + deployment pair.
 *
 * Extracted from ScenarioManager so callers that need only the config - evals,
 * capture/generation tooling - can obtain it without constructing the full manager.
 * Production callers that need the full lifecycle (up/down/ingest) should use
 * ScenarioManager, which delegates to this function internally.
 */
export async function resolveSdkConfig(params: {
    applicationId: string;
    deploymentId: string;
    db: PrismaClient;
    encryption: EncryptionHelper;
    sdkUrlOverride?: string;
}): Promise<SdkConfig> {
    const { applicationId, deploymentId, db, encryption, sdkUrlOverride } = params;

    const application = await db.application.findUnique({
        where: { id: applicationId },
        select: { id: true, signingSecretEnc: true, organizationId: true, disabled: true },
    });

    if (application == null) {
        throw new Error(`Application ${applicationId} not found`);
    }
    if (application.disabled) {
        throw new Error(`Application ${applicationId} is disabled`);
    }
    if (application.signingSecretEnc == null) {
        throw new Error(`Application ${applicationId} does not have a signing secret configured`);
    }

    const deployment = await db.branchDeployment.findUnique({
        where: { id: deploymentId },
        select: { id: true, webhookUrl: true, webhookHeaders: true },
    });

    if (deployment == null) {
        throw new Error(`Deployment ${deploymentId} not found`);
    }

    const signingSecret = encryption.decrypt(application.signingSecretEnc);
    const customHeaders =
        deployment.webhookHeaders != null ? (deployment.webhookHeaders as Record<string, string>) : undefined;

    const sdkUrl = sdkUrlOverride ?? deployment.webhookUrl;
    if (sdkUrl == null) {
        throw new Error(`Deployment ${deploymentId} does not have an SDK URL configured`);
    }

    return {
        applicationId: application.id,
        sdkUrl,
        signingSecret,
        customHeaders,
    };
}
