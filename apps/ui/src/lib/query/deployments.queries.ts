import { type QueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ensureAPIQueryData } from "lib/query/api-queries";
import { trpc } from "lib/trpc";

export function useDeploymentsByPr(applicationId: string, prNumber: number) {
    return useSuspenseQuery(trpc.deployments.listByPr.queryOptions({ applicationId, prNumber }));
}

const PREVIEW_POLL_MS = 5_000;
// Frontend preview statuses that are still in flight (a redeploy is building or pending). Terminal
// statuses (ready/degraded/failed/stopped/missing/unknown) stop the poll.
const ACTIVE_PREVIEW_STATUSES: ReadonlySet<string> = new Set(["building", "stale"]);
const ACTIVE_PREVIEW_PHASES: ReadonlySet<string> = new Set(["deploy_requested"]);

export function usePreviewEnvironmentSummary(
    applicationId: string,
    prNumber: number,
    options?: { refetchWhileActive?: boolean },
) {
    return useSuspenseQuery({
        ...trpc.deployments.previewSummaryByPr.queryOptions({ applicationId, prNumber }),
        refetchInterval: (query) => {
            const status = query.state.data?.status ?? "";
            const phase = query.state.data?.phase ?? "";
            const previewIsActive = ACTIVE_PREVIEW_STATUSES.has(status) || ACTIVE_PREVIEW_PHASES.has(phase);
            return options?.refetchWhileActive === true && previewIsActive ? PREVIEW_POLL_MS : false;
        },
    });
}

export async function ensureDeploymentsByPrData(queryClient: QueryClient, applicationId: string, prNumber: number) {
    await ensureAPIQueryData(queryClient, trpc.deployments.listByPr.queryOptions({ applicationId, prNumber }));
}

export async function ensurePreviewEnvironmentSummaryData(
    queryClient: QueryClient,
    applicationId: string,
    prNumber: number,
) {
    await ensureAPIQueryData(
        queryClient,
        trpc.deployments.previewSummaryByPr.queryOptions({ applicationId, prNumber }),
    );
}
