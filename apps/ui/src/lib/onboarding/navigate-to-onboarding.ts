import type { NavigateFn } from "@tanstack/react-router";
import type { OnboardingStep } from "./onboarding-steps";

const STEP_ROUTES: Record<string, OnboardingStep> = {
    install: "cli-setup",
    configure: "cli-setup",
    working: "cli-setup",
    webhook_configuring: "scenario-dry-run",
    discovering: "scenario-dry-run",
    discovered: "scenario-dry-run",
    dry_run_passed: "scenario-dry-run",
    url: "scenario-dry-run",
    github: "github",
    completed: "complete",
};

export function navigateToOnboarding(applicationId: string, step: string | undefined, navigate: NavigateFn) {
    const resolvedStep: OnboardingStep = STEP_ROUTES[step ?? "webhook_configuring"] ?? "cli-setup";
    void navigate({ to: "/onboarding", search: { step: resolvedStep, appId: applicationId } });
}
