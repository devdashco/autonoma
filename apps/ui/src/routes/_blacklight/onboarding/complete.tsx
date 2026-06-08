import { buttonVariants } from "@autonoma/blacklight";
import { BugIcon } from "@phosphor-icons/react/Bug";
import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_blacklight/onboarding/complete")({
  component: () => (
    <Navigate to="/onboarding" search={{ step: "complete", appId: undefined, apiKey: undefined, setupId: undefined }} />
  ),
});

export function CompletePage() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      void navigate({ to: "/", replace: true });
    }, 2000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <>
      <style>{`
        @keyframes bugFloat {
          0%, 100% { transform: translateY(0) rotate(-6deg); }
          30% { transform: translateY(-14px) rotate(7deg); }
          60% { transform: translateY(-8px) rotate(-3deg); }
          80% { transform: translateY(-16px) rotate(9deg); }
        }
        @keyframes bugGlow {
          0%, 100% { box-shadow: 0 0 16px var(--accent-glow), 0 0 32px var(--accent-glow); }
          50% { box-shadow: 0 0 32px var(--accent-glow), 0 0 64px var(--accent-glow); }
        }
      `}</style>

      <div className="flex flex-col items-center py-10 text-center sm:py-12">
        <div
          className="mb-10 flex size-28 items-center justify-center rounded-full border border-primary-ink/20 bg-surface-base"
          style={{ animation: "bugGlow 3s ease-in-out infinite" }}
        >
          <BugIcon
            size={52}
            weight="duotone"
            className="text-primary-ink"
            style={{ animation: "bugFloat 4s ease-in-out infinite" }}
          />
        </div>

        <h1 className="mt-4 text-5xl font-medium tracking-tight text-text-primary">Ready to hunt some bugs</h1>

        <p className="mt-5 max-w-md text-base leading-relaxed text-text-secondary">
          Your scenarios are live. Autonoma will run them automatically and alert you when something breaks.
        </p>

        <Link
          to="/"
          className={buttonVariants({
            variant: "accent",
            className: "mt-14 gap-3 px-10 py-4 font-mono text-sm font-bold uppercase",
          })}
          aria-label="onboarding-complete-start-now"
        >
          <BugIcon size={18} weight="bold" />
          Start now
        </Link>

        <p className="mt-4 font-mono text-2xs text-text-tertiary opacity-60">Let the bug hunting season begin</p>
      </div>
    </>
  );
}
