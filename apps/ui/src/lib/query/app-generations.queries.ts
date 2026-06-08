import { useSuspenseQuery } from "@tanstack/react-query";
import { trpc } from "lib/trpc";

export function usePollApplicationSetup(applicationId: string) {
    return useSuspenseQuery(
        trpc.applicationSetups.getLatest.queryOptions({ applicationId }, { refetchInterval: 2000 }),
    );
}

/**
 * Polls the per-artifact upload status while the planner CLI runs. Stops polling
 * once the CLI marks the setup complete. Used by the onboarding Setup step to
 * check artifacts off as they arrive and auto-advance when everything has landed.
 */
export function useArtifactStatus(applicationId: string) {
    return useSuspenseQuery(
        trpc.applicationSetups.artifactStatus.queryOptions(
            { applicationId },
            { refetchInterval: (query) => (query.state.data?.complete === true ? false : 5000) },
        ),
    );
}
