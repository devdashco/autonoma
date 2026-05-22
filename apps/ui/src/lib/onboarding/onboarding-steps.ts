export const ONBOARDING_STEPS = ["cli-setup", "scenario-dry-run", "github", "complete"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function isOnboardingStep(value: string): value is OnboardingStep {
    return ONBOARDING_STEPS.includes(value as OnboardingStep);
}
