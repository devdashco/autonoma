import { createSentryServiceInterceptor } from "@autonoma/workflow/worker";

export const sentryServiceInterceptor = createSentryServiceInterceptor(
    {
        runWebGeneration: "engine-web",
        runWebReplay: "engine-web",
    },
    "worker-web",
);
