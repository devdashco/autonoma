import { createSentryServiceInterceptor } from "@autonoma/workflow/worker";

export const sentryServiceInterceptor = createSentryServiceInterceptor(
    {
        runMobileGeneration: "engine-mobile",
        runMobileReplay: "engine-mobile",
    },
    "worker-mobile",
);
