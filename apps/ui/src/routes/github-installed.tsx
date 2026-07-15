import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Terminal page for the add-another-repo install flow, which opens GitHub in a
 * NEW tab. After GitHub grants the app access it redirects here; the user's real
 * work is still in the original tab (which refreshes its repo list on focus), so
 * this page just tells them to close this one and go back. It is standalone (no
 * app shell): there is nothing to do here but close.
 */
export const Route = createFileRoute("/github-installed")({
  validateSearch: z.object({
    error: z.string().optional(),
  }),
  component: GithubInstalledPage,
});

function GithubInstalledPage() {
  const { error } = Route.useSearch();
  const failed = error != null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-void p-6">
      <div className="flex max-w-md flex-col items-center gap-4 border border-border-dim bg-surface-base p-8 text-center">
        {failed ? (
          <WarningCircleIcon size={40} weight="fill" className="text-status-critical" />
        ) : (
          <CheckCircleIcon size={40} weight="fill" className="text-status-success" />
        )}
        <h1 className="text-xl font-medium text-text-primary">
          {failed ? "Couldn't grant access" : "GitHub access granted"}
        </h1>
        <p className="text-sm text-text-secondary">
          {failed ? (
            <>Something went wrong granting access. Close this tab and try again from Autonoma.</>
          ) : (
            <>
              GitHub granted Autonoma access to your repositories. You can close this tab and go back to the Autonoma
              tab - your new repo will appear there.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => window.close()}
          className="mt-2 border border-border-mid px-4 py-2 font-mono text-2xs uppercase tracking-widest text-text-secondary transition-colors hover:border-border-highlight hover:text-text-primary"
        >
          Close tab
        </button>
      </div>
    </div>
  );
}
