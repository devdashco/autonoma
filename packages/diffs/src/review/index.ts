// Kernel: generic agent-loop primitives shared by every reviewer.
export {
    extractVerdict,
    tryUploadVideo,
    buildScreenshotTools,
    buildVerdictTool,
    runReviewAgent,
    MessageBuilder,
    sanitizeConversation,
    type VideoDownloader,
    type ScreenshotLoader,
    type ReviewStepScreenshots,
    type BuildScreenshotToolsParams,
    type ReviewAgentResult,
    type RunReviewAgentParams,
} from "./kernel";

// Generation reviewer: 4-outcome classifier, runs on every generation.
export {
    GenerationContextLoader,
    GenerationReviewer,
    GenerationReviewPersister,
    buildGenerationReviewMessages,
    runGenerationReview,
    type GenerationReviewerDeps,
    type GenerationReviewResult,
    type PersistGenerationReviewParams,
    type RunGenerationReviewDeps,
    type RunGenerationReviewResult,
    type GenerationContext,
    type GenerationStepData,
} from "./generation";

// Replay reviewer: binary classifier, failure-only.
export {
    RunContextLoader,
    ReplayReviewer,
    RunReviewPersister,
    buildReplayReviewMessages,
    runReplayReview,
    type ReplayReviewerDeps,
    type ReplayReviewResult,
    type PersistRunReviewParams,
    type RunReplayReviewDeps,
    type RunReplayReviewResult,
    type RunContext,
    type RunStepData,
} from "./replay";
