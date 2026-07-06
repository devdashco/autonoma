import { Button } from "@autonoma/blacklight";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { ensureInvestigationReportData } from "lib/query/branches.queries";

export const Route = createFileRoute(
  "/_blacklight/_app-shell/app/$appSlug/pull-requests/$prNumber/snapshots/$snapshotId/investigation",
)({
  loader: async ({ context, params: { snapshotId } }) => {
    await ensureInvestigationReportData(context.queryClient, snapshotId);
  },
  component: Outlet,
  // Absence is handled by the pages themselves (the report query resolves to null, and each page renders a
  // graceful "not available / still running" state). This boundary is the last-resort net for an UNEXPECTED
  // failure (a network error, a bad response) so the investigation view degrades to a calm message with a retry
  // instead of the app-wide "Something went wrong" crash screen.
  errorComponent: InvestigationErrorState,
});

function InvestigationErrorState({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border-dim bg-surface-base px-6 py-12 text-center">
      <MagnifyingGlassIcon size={28} className="text-text-secondary" />
      <p className="text-sm text-text-secondary">We couldn&apos;t load the investigation for this checkpoint.</p>
      <Button variant="outline" size="xs" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
