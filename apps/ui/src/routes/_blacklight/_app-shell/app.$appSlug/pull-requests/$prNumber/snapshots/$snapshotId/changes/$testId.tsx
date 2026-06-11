import { createFileRoute } from "@tanstack/react-router";
import { SnapshotChangesDetail } from "components/snapshot/snapshot-changes-detail";

export const Route = createFileRoute(
  "/_blacklight/_app-shell/app/$appSlug/pull-requests/$prNumber/snapshots/$snapshotId/changes/$testId",
)({
  component: SnapshotChangesDetail,
});
