import { Outlet, createFileRoute } from "@tanstack/react-router";
import { ensureInvestigationReportData } from "lib/query/branches.queries";

export const Route = createFileRoute(
  "/_blacklight/_app-shell/app/$appSlug/pull-requests/$prNumber/snapshots/$snapshotId/investigation",
)({
  loader: async ({ context, params: { snapshotId } }) => {
    await ensureInvestigationReportData(context.queryClient, snapshotId);
  },
  component: Outlet,
});
