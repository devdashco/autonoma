import { createSentryServiceInterceptor } from "@autonoma/workflow/worker";

export const sentryServiceInterceptor = createSentryServiceInterceptor(
    {
        preparePreviewDeploy: "previewkit",
        buildPreviewImages: "previewkit",
        deployPreviewEnvironment: "previewkit",
        finalizePreviewDeploy: "previewkit",
        failPreviewDeploy: "previewkit",
    },
    "worker-previewkit",
);
