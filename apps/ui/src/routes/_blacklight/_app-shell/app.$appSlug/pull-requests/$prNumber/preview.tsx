import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "routes/_blacklight/_app-shell/-app-link";

export const Route = createFileRoute("/_blacklight/_app-shell/app/$appSlug/pull-requests/$prNumber/preview")({
  component: PreviewEnvironmentPage,
});

function PreviewEnvironmentPage() {
  const { prNumber } = Route.useParams();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-text-secondary">
          <AppLink
            to="/app/$appSlug/pull-requests/$prNumber"
            params={{ prNumber }}
            aria-label="Back to pull request"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
          >
            <ArrowLeftIcon size={12} />
          </AppLink>
          <GlobeIcon size={14} />
          <span className="font-mono text-2xs uppercase tracking-widest">Preview environment</span>
          <span className="font-mono text-2xs">#{prNumber}</span>
        </div>
        <h1 className="text-2xl font-medium tracking-tight text-text-primary">Preview environment</h1>
      </header>

      <div className="flex flex-col items-center justify-center gap-4 border border-dashed border-border-mid bg-surface-base px-6 py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-full border border-border-mid bg-surface-raised text-primary-ink">
          <GlobeIcon size={22} />
        </div>
        <div className="flex max-w-md flex-col gap-1.5">
          <h2 className="text-lg font-semibold text-text-primary">Coming soon</h2>
          <p className="text-sm text-text-secondary">
            A dedicated view for this pull request's preview environment - services, URLs, build status, and deploy
            history - is on the way.
          </p>
        </div>
      </div>
    </div>
  );
}
