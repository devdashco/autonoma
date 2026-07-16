import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useAPIMutation } from "lib/query/api-queries";
import { trpc } from "lib/trpc";

export function usePollApplicationSetup(applicationId: string) {
    return useSuspenseQuery(
        trpc.applicationSetups.getLatest.queryOptions({ applicationId }, { refetchInterval: 2000 }),
    );
}

/**
 * Polls the per-artifact upload status while the planner CLI runs. Keeps polling
 * until the step is genuinely done (`stepComplete` - run completed AND every
 * artifact received) rather than just `complete`, so a later re-upload is picked
 * up without a manual refresh. `stepComplete` is computed server-side so the gate
 * is never re-derived here.
 */
export function useArtifactStatus(applicationId: string) {
    return useSuspenseQuery(
        trpc.applicationSetups.artifactStatus.queryOptions(
            { applicationId },
            { refetchInterval: (query) => (query.state.data?.stepComplete === true ? false : 5000) },
        ),
    );
}

/**
 * Mints an upload token + setup so the Finish setup tab can render a working
 * planner CLI command. One server call; the command renders immediately and the
 * token fills in when this resolves.
 */
export function usePrepareCliSetup() {
    return useAPIMutation(trpc.applicationSetups.prepareCliSetup.mutationOptions());
}

export function useUploadScenarioRecipeVersions() {
    return useAPIMutation(trpc.applicationSetups.uploadScenarioRecipeVersions.mutationOptions());
}

export function useUploadSetupArtifacts() {
    return useAPIMutation(trpc.applicationSetups.uploadArtifacts.mutationOptions());
}

export function useUpdateSetup(applicationId: string) {
    const queryClient = useQueryClient();
    return useAPIMutation(
        trpc.applicationSetups.updateSetup.mutationOptions({
            onSettled: () => {
                void queryClient.invalidateQueries({
                    queryKey: trpc.applicationSetups.artifactStatus.queryKey({ applicationId }),
                });
                void queryClient.invalidateQueries({
                    queryKey: trpc.onboarding.getState.queryKey({ applicationId }),
                });
            },
        }),
    );
}
