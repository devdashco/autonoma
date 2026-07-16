import type { PrismaClient } from "@autonoma/db";
import type {
    ArtifactStatus,
    UpdateSetupBody,
    UploadArtifactsBody,
    UploadScenarioRecipeVersionsBody,
} from "@autonoma/types";
import type { ApplicationSetupService } from "../../application-setup/application-setup.service";
import type { ApiKeysService } from "../api-keys/api-keys.service";
import { Service } from "../service";
import { computeArtifactStatus } from "./artifact-status";

/** Result of preparing the in-app CLI deepening command: a fresh upload token plus its setup. */
export interface PreparedCliSetup {
    apiKey: string;
    setupId: string;
}

export class ApplicationSetupsService extends Service {
    constructor(
        private readonly db: PrismaClient,
        private readonly applicationSetup: ApplicationSetupService,
        private readonly apiKeys: ApiKeysService,
    ) {
        super();
    }

    async getLatest(organizationId: string, applicationId: string) {
        return await this.db.applicationSetup.findFirst({
            where: { applicationId, organizationId },
            orderBy: { createdAt: "desc" },
            include: {
                events: { orderBy: { createdAt: "asc" } },
            },
        });
    }

    async getById(setupId: string, organizationId: string) {
        return await this.db.applicationSetup.findFirst({
            where: { id: setupId, organizationId },
            include: {
                events: { orderBy: { createdAt: "asc" } },
            },
        });
    }

    /**
     * Per-artifact upload progress for the onboarding "Setup" step. The UI polls
     * this every 5s while the planner CLI runs and auto-advances once `complete`
     * flips (the CLI marks the setup `completed` after its final upload).
     */
    async artifactStatus(organizationId: string, applicationId: string): Promise<ArtifactStatus> {
        this.logger.info("Fetching artifact status", { extra: { applicationId, organizationId } });
        return computeArtifactStatus(this.db, applicationId, organizationId);
    }

    /**
     * Mint an upload token + resolve the setup so the Finish setup tab can render
     * a working planner CLI command (`AUTONOMA_API_TOKEN` + `AUTONOMA_GENERATION_ID`).
     *
     * The setup is REUSED, not recreated: creating a fresh setup per mount would
     * churn the `AUTONOMA_GENERATION_ID`, and since status reads the newest setup an
     * empty new setup would shadow a completed CLI run and reset the step on refresh.
     * So we pin to `setupId` when the caller supplies one (the id persisted in the
     * URL), otherwise reuse the app's latest non-`failed` setup, and only create a
     * new one when there is nothing usable to reuse.
     *
     * A fresh API key is still minted each call - keys are cheap and rotatable, and
     * the key (unlike the setup id) is not what the status/completion logic keys on.
     */
    async prepareCliSetup(
        userId: string,
        organizationId: string,
        applicationId: string,
        pinnedSetupId?: string,
    ): Promise<PreparedCliSetup> {
        this.logger.info("Preparing CLI setup", { extra: { applicationId, organizationId, pinnedSetupId } });
        const [apiKey, resolvedSetupId] = await Promise.all([
            this.apiKeys.create(userId, organizationId, `finish-setup-${applicationId}`),
            this.resolveReusableSetup(userId, organizationId, applicationId, pinnedSetupId),
        ]);
        return { apiKey: apiKey.key, setupId: resolvedSetupId };
    }

    /**
     * Pick the setup a CLI command should target: `pinnedSetupId` (the id the UI
     * persists in the URL) if it belongs to this app, else the app's latest
     * non-`failed` setup, else a freshly created one. Keeping the id stable across
     * refreshes is what stops the reset bug.
     */
    private async resolveReusableSetup(
        userId: string,
        organizationId: string,
        applicationId: string,
        pinnedSetupId?: string,
    ): Promise<string> {
        if (pinnedSetupId != null) {
            const pinned = await this.db.applicationSetup.findFirst({
                where: { id: pinnedSetupId, applicationId, organizationId },
                select: { id: true },
            });
            if (pinned != null) return pinned.id;
            this.logger.warn("Pinned setup not found for app; falling back to latest", {
                extra: { applicationId, pinnedSetupId },
            });
        }

        const latest = await this.db.applicationSetup.findFirst({
            where: { applicationId, organizationId, status: { not: "failed" } },
            orderBy: { createdAt: "desc" },
            select: { id: true },
        });
        if (latest != null) return latest.id;

        const setup = await this.applicationSetup.createSetup(userId, organizationId, applicationId);
        return setup.id;
    }

    async uploadScenarioRecipeVersions(
        setupId: string,
        organizationId: string,
        body: UploadScenarioRecipeVersionsBody,
    ) {
        this.logger.info("Uploading scenario recipe versions", { extra: { setupId, organizationId } });
        return await this.applicationSetup.uploadScenarioRecipeVersions(setupId, organizationId, body);
    }

    async uploadArtifacts(setupId: string, organizationId: string, body: UploadArtifactsBody) {
        this.logger.info("Uploading setup artifacts", { extra: { setupId, organizationId } });
        await this.applicationSetup.uploadArtifacts(setupId, organizationId, body);
        return { ok: true as const };
    }

    async updateSetup(setupId: string, organizationId: string, body: UpdateSetupBody) {
        this.logger.info("Updating setup", { extra: { setupId, organizationId } });
        await this.applicationSetup.updateSetup(setupId, organizationId, body);
        return { ok: true as const };
    }
}
