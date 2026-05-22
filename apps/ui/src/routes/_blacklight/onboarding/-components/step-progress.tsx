import { cn } from "@autonoma/blacklight";
import { Link } from "@tanstack/react-router";
import type { OnboardingStep } from "lib/onboarding/onboarding-steps";

interface StepDef {
  id: OnboardingStep;
  label: string;
}

const STEPS: StepDef[] = [
  { id: "cli-setup", label: "Setup" },
  { id: "scenario-dry-run", label: "Deploy Autonoma SDK" },
  { id: "github", label: "Connect GitHub" },
];

const ALL_STEP_IDS = STEPS.map((step) => step.id);

interface StepProgressProps {
  currentStepId: string;
}

export function StepProgress({ currentStepId }: StepProgressProps) {
  const resolvedCurrentStep = ALL_STEP_IDS.includes(currentStepId as OnboardingStep)
    ? (currentStepId as OnboardingStep)
    : "cli-setup";
  const currentIndex = ALL_STEP_IDS.indexOf(resolvedCurrentStep);

  return (
    <div className="flex flex-col">
      {STEPS.map((step, stepIndex) => {
        const globalIndex = ALL_STEP_IDS.indexOf(step.id);
        const isActive = step.id === currentStepId;
        const isCompleted = globalIndex < currentIndex;
        const isLast = stepIndex === STEPS.length - 1;

        const content = (
          <>
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full transition-colors",
                  isActive && "bg-primary-ink shadow-[0_0_8px_var(--accent-glow)]",
                  isCompleted && "bg-primary-ink",
                  !isActive && !isCompleted && "border border-border-dim bg-surface-void",
                )}
              />
              {!isLast && (
                <div
                  className={cn(
                    "my-1 w-px flex-1 transition-colors",
                    isActive && "bg-primary-ink shadow-[0_0_10px_var(--accent-glow)]",
                    isCompleted && "bg-primary-ink/40",
                    !isActive && !isCompleted && "bg-border-dim",
                  )}
                />
              )}
            </div>

            <div className={cn("flex flex-col gap-1 pb-8", isLast && "pb-0")}>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-sm font-medium tracking-wide transition-colors",
                    isActive
                      ? "text-text-primary"
                      : isCompleted
                        ? "text-text-secondary group-hover:text-text-primary"
                        : "text-text-secondary",
                  )}
                >
                  {step.label}
                </span>
                {isActive && (
                  <span className="border border-primary-ink/30 bg-primary-ink/10 px-1.5 py-0.5 font-mono text-4xs uppercase tracking-widest text-primary-ink">
                    Current
                  </span>
                )}
              </div>
            </div>
          </>
        );

        if (isCompleted) {
          return (
            <Link
              key={step.id}
              to="/onboarding"
              search={{ step: step.id, appId: undefined }}
              className="group flex cursor-pointer gap-5"
            >
              {content}
            </Link>
          );
        }

        return (
          <div key={step.id} className="flex gap-5">
            {content}
          </div>
        );
      })}
    </div>
  );
}
