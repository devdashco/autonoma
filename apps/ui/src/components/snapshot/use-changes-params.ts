import { useParams } from "@tanstack/react-router";

const CHANGES_ROUTE_ID = "/_blacklight/_app-shell/app/$appSlug/pull-requests/$prNumber/snapshots/$snapshotId/changes";
const CHANGES_DETAIL_ROUTE_ID =
    "/_blacklight/_app-shell/app/$appSlug/pull-requests/$prNumber/snapshots/$snapshotId/changes/$testId";

// Params for the snapshot changes layout route ({ appSlug, prNumber, snapshotId }).
export function useChangesParams() {
    return useParams({ from: CHANGES_ROUTE_ID });
}

// Params for the snapshot changes detail route, including the selected `testId`.
export function useChangesDetailParams() {
    return useParams({ from: CHANGES_DETAIL_ROUTE_ID });
}
