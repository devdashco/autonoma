import type { ConfigStepId } from "./config-steps";
import type { OnboardingStep } from "./onboarding-steps";

type FocusSection = "config" | "secrets" | "logs";

interface OnboardingSearchOverrides {
    error?: string;
    apiKey?: string;
    setupId?: string;
    focusApp?: string;
    focusField?: string;
    focusSection?: FocusSection;
    /** Active sub-step of the PreviewKit config step, so the sidebar can reflect it. */
    configStep?: ConfigStepId;
}

/**
 * Builds the full search object for the `/onboarding` route. Every onboarding
 * navigation must spell out all search keys, so this centralizes the `undefined`
 * defaults and lets call sites pass only the step (and any focus overrides).
 */
export function buildOnboardingSearch(step: OnboardingStep, appId?: string, overrides: OnboardingSearchOverrides = {}) {
    return {
        step,
        appId,
        error: overrides.error,
        apiKey: overrides.apiKey,
        setupId: overrides.setupId,
        focusApp: overrides.focusApp,
        focusField: overrides.focusField,
        focusSection: overrides.focusSection,
        configStep: overrides.configStep,
    };
}
