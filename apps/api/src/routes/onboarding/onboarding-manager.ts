import type { PrismaClient } from "@autonoma/db";
import { type Logger, logger } from "@autonoma/logger";
import type { EncryptionHelper, ScenarioManager } from "@autonoma/scenario";
import { triggerRefinementLoop } from "@autonoma/workflow";
import { CompletedState } from "./states/completed-state";
import { DiscoveredState } from "./states/discovered-state";
import { DiscoveringState } from "./states/discovering-state";
import { DryRunPassedState } from "./states/dry-run-passed-state";
import { GitHubState } from "./states/github-state";
import type { OnboardingState, OnboardingStateDeps } from "./states/onboarding-state";
import { UrlState } from "./states/url-state";
import { WebhookConfiguringState } from "./states/webhook-configuring-state";

/**
 * If a row has been stuck at `discovering` for longer than this, assume the
 * API died mid-call and auto-recover to `webhook_configuring` with an error.
 * Longer than the webhook's own timeout+retry budget, short enough that the
 * user isn't locked out for long after a real crash.
 */
const DISCOVERING_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Ordered list of onboarding steps. Used to determine whether an operation
 * from an earlier step should be allowed when the user is at a later step.
 */
const LEGACY_STEPS: ReadonlySet<string> = new Set(["install", "configure", "working"]);

const STEP_ORDER: OnboardingState["step"][] = [
    "install",
    "configure",
    "working",
    "webhook_configuring",
    "discovering",
    "discovered",
    "dry_run_passed",
    "url",
    "github",
    "completed",
];

/**
 * Facade for the onboarding state machine.
 *
 * Every public method loads the current {@link OnboardingState} subclass from the
 * database and delegates the operation to it. This keeps the manager thin while
 * the state subclasses enforce which transitions are valid at each step.
 *
 * For backwards-compatible operations (e.g. re-running a scenario dry run from
 * the github step), the manager loads the state that implements the operation
 * instead of the current state. This allows users to go back and redo earlier
 * steps without the state machine rejecting them.
 *
 * Flow: webhook_configuring -> discovered -> dry_run_passed -> url -> github -> completed.
 * Reset is available from any step.
 */
export class OnboardingManager {
    private readonly logger: Logger;

    private static readonly states: Partial<
        Record<
            OnboardingState["step"],
            new (applicationId: string, db: PrismaClient, deps: OnboardingStateDeps) => OnboardingState
        >
    > = {
        webhook_configuring: WebhookConfiguringState,
        discovering: DiscoveringState,
        discovered: DiscoveredState,
        dry_run_passed: DryRunPassedState,
        url: UrlState,
        github: GitHubState,
        completed: CompletedState,
    };

    constructor(
        private readonly db: PrismaClient,
        private readonly scenarioManager: ScenarioManager,
        private readonly encryption: EncryptionHelper,
    ) {
        this.logger = logger.child({ name: "OnboardingManager" });
    }

    async getState(applicationId: string) {
        this.logger.info("Getting onboarding state", { applicationId });

        let row = await this.db.onboardingState.upsert({
            where: { applicationId },
            create: { applicationId },
            update: {},
        });

        // Legacy shim: rows stuck on removed install/configure/working steps
        // are auto-migrated to webhook_configuring (the new starting step).
        if (LEGACY_STEPS.has(row.step)) {
            this.logger.warn("Migrating legacy onboarding step to webhook_configuring", {
                applicationId,
                legacyStep: row.step,
            });
            row = await this.db.onboardingState.update({
                where: { applicationId },
                data: { step: "webhook_configuring" },
            });
        }

        // Crash recovery: if a prior discover call died mid-flight, the row is
        // stuck at `discovering` with `discoveringStartedAt` set. Roll back to
        // `webhook_configuring` so the user can retry.
        if (row.step === "discovering" && this.isDiscoveryStuck(row.discoveringStartedAt)) {
            this.logger.warn("Recovering stuck `discovering` state", {
                applicationId,
                discoveringStartedAt: row.discoveringStartedAt,
            });
            row = await this.db.onboardingState.update({
                where: { applicationId },
                data: {
                    step: "webhook_configuring",
                    discoveringStartedAt: null,
                    lastDiscoveryError: "Discovery timed out or crashed. Please retry.",
                },
            });
        }

        const stepIndex = STEP_ORDER.indexOf(row.step);
        const discoveredIndex = STEP_ORDER.indexOf("discovered");
        const webhookConfigured = stepIndex >= discoveredIndex;
        const discoveryInProgress = row.step === "discovering";

        return { ...row, webhookConfigured, discoveryInProgress };
    }

    private isDiscoveryStuck(startedAt: Date | null): boolean {
        if (startedAt == null) return false;
        return Date.now() - startedAt.getTime() > DISCOVERING_TIMEOUT_MS;
    }

    /** Return the agent log entries for the application. */
    async getLogs(applicationId: string) {
        const row = await this.db.onboardingState.findUnique({
            where: { applicationId },
            select: { agentLogs: true },
        });

        return { logs: row?.agentLogs ?? [] };
    }

    /** Store the production URL, move from `url` to `github`. Works from url or any later step. */
    async setUrl(applicationId: string, productionUrl: string) {
        this.logger.info("Setting production URL", { applicationId });
        const state = await this.loadStateOrEarlier(applicationId, "url");
        await state.setUrl(productionUrl);
        return this.getState(applicationId);
    }

    /** Move from `github` to `completed` and enqueue initial test generations. Works from github or completed. */
    async completeGithub(applicationId: string, organizationId: string) {
        this.logger.info("Completing GitHub step", { applicationId });
        const state = await this.loadStateOrEarlier(applicationId, "github");
        await state.completeGithub();
        await this.enqueueGenerations(applicationId, organizationId);
        return this.getState(applicationId);
    }

    async configureAndDiscoverScenarios(
        applicationId: string,
        organizationId: string,
        webhookUrl: string,
        signingSecret: string,
        webhookHeaders?: Record<string, string>,
    ) {
        this.logger.info("Configuring webhook for dry run", { applicationId });
        const state = await this.loadStateOrEarlier(applicationId, "webhook_configuring");
        return state.configureAndDiscoverScenarios(organizationId, webhookUrl, signingSecret, webhookHeaders);
    }

    /** Execute a scenario up + down cycle. Works from discovered or any later step. */
    async runScenarioDryRun(applicationId: string, scenarioId: string) {
        this.logger.info("Running scenario dry run", { applicationId, scenarioId });
        const state = await this.loadStateOrEarlier(applicationId, "discovered");
        return state.runScenarioDryRun(scenarioId);
    }

    /** Return to `webhook_configuring` so the user can edit URL/secret. */
    async reconfigureWebhook(applicationId: string) {
        this.logger.info("Reconfiguring webhook", { applicationId });
        const state = await this.loadState(applicationId);
        await state.reconfigureWebhook();
        return this.getState(applicationId);
    }

    /** Advance from `dry_run_passed` to `github`, optionally storing a production URL. */
    async complete(applicationId: string, productionUrl?: string) {
        this.logger.info("Advancing to github step", { applicationId, hasProductionUrl: productionUrl != null });
        const state = await this.loadStateOrEarlier(applicationId, "dry_run_passed");
        await state.complete(productionUrl);
        return this.getState(applicationId);
    }

    async reset(applicationId: string) {
        this.logger.info("Resetting onboarding", { applicationId });
        await this.db.onboardingState.update({
            where: { applicationId },
            data: {
                step: "webhook_configuring",
                agentConnectedAt: null,
                agentLogs: [],
                productionUrl: null,
                completedAt: null,
                lastDiscoveryError: null,
                lastDiscoveredAt: null,
                lastDiscoveredModels: null,
                discoveringStartedAt: null,
            },
        });
        return this.getState(applicationId);
    }

    /** Upsert the onboarding row and instantiate the matching state subclass. */
    private async loadState(applicationId: string): Promise<OnboardingState> {
        const initialOnboardingState = await this.db.onboardingState.upsert({
            where: { applicationId },
            create: { applicationId },
            select: { step: true },
            update: {},
        });
        return this.createOnboardingState(applicationId, initialOnboardingState.step);
    }

    /**
     * Load the state for an operation that should work from `minimumStep` or any later step.
     *
     * If the current step is at or past `minimumStep`, instantiates `minimumStep`'s state
     * so the operation's logic runs correctly. If the current step is before `minimumStep`,
     * instantiates the current state (which will throw InvalidOnboardingStepError as expected).
     */
    private async loadStateOrEarlier(
        applicationId: string,
        minimumStep: OnboardingState["step"],
    ): Promise<OnboardingState> {
        const row = await this.db.onboardingState.upsert({
            where: { applicationId },
            create: { applicationId },
            select: { step: true },
            update: {},
        });

        const currentIndex = STEP_ORDER.indexOf(row.step);
        const minimumIndex = STEP_ORDER.indexOf(minimumStep);

        // If we're at or past the minimum step, use the minimum step's state
        // so its operation logic runs. Otherwise, use the current state (which will reject).
        const effectiveStep = currentIndex >= minimumIndex ? minimumStep : row.step;
        this.logger.info("Loading state for backwards-compatible operation", {
            applicationId,
            currentStep: row.step,
            minimumStep,
            effectiveStep,
        });
        return this.createOnboardingState(applicationId, effectiveStep);
    }

    private createOnboardingState(applicationId: string, step: OnboardingState["step"]): OnboardingState {
        const deps: OnboardingStateDeps = {
            scenarioManager: this.scenarioManager,
            encryption: this.encryption,
        };
        const effectiveStep = LEGACY_STEPS.has(step) ? "webhook_configuring" : step;
        const stateConstructor = OnboardingManager.states[effectiveStep];
        if (stateConstructor == null) {
            throw new Error(`No state handler for step "${effectiveStep}"`);
        }
        return new stateConstructor(applicationId, this.db, deps);
    }

    /**
     * Trigger the refinement loop on the application's main branch after onboarding completes.
     * The loop fires pending generations, validates them, and finalizes the snapshot.
     */
    async enqueueGenerations(applicationId: string, organizationId: string) {
        const app = await this.db.application.findFirst({
            where: { id: applicationId, organizationId },
            select: { mainBranch: { select: { id: true, pendingSnapshotId: true } } },
        });
        const branchId = app?.mainBranch?.id;
        const pendingSnapshotId = app?.mainBranch?.pendingSnapshotId;

        if (branchId == null || pendingSnapshotId == null) {
            this.logger.info("No pending snapshot to refine after onboarding", {
                applicationId,
                branchId,
            });
            return;
        }

        try {
            this.logger.info("Triggering refinement loop after onboarding", {
                applicationId,
                branchId,
                snapshotId: pendingSnapshotId,
            });
            await triggerRefinementLoop({
                snapshotId: pendingSnapshotId,
                triggeredBy: "onboarding",
            });
            this.logger.info("Refinement loop triggered", { applicationId, branchId });
        } catch (err) {
            // Log but don't block onboarding completion - the refinement can be retried later.
            this.logger.error("Failed to trigger refinement loop after onboarding", {
                applicationId,
                branchId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
