import { InlineMp4VideoUploader } from "../object/video/inline-mp4-video-uploader";
import type { VideoUploader } from "../object/video/video-processor";
import { type CostFunction, simpleCostFunction } from "./costs";
import type { LanguageModel } from "./model-registry";
import { openRouterProvider } from "./providers";

export interface ModelEntry {
    createModel: () => LanguageModel;
    pricing: CostFunction;
    /**
     * Factory for the {@link VideoUploader} this model needs to accept video input. Present only on
     * video-capable entries: the model and the uploader its provider requires are declared together
     * here so they can never drift apart. Google models use the Files-API {@link VideoProcessor};
     * OpenRouter-routed models use the inline-mp4 {@link InlineMp4VideoUploader}.
     */
    createUploader?: () => VideoUploader;
}

// SELF-HOST: every logical model is routed to Claude Haiku through the
// llm.hostbun.cc gateway (OpenAI-compatible), reached via the openRouter
// provider whose baseURL is OPENROUTER_BASE_URL. One model for all roles keeps
// the self-host config trivial; Haiku is multimodal so it covers the visual
// (screenshot point-detection) roles too. Pricing is nominal (gateway meters).
const HAIKU = "claude-haiku-4-5";
const haikuEntry = (video: boolean): ModelEntry => ({
    createModel: () => openRouterProvider.getModel(HAIKU),
    pricing: simpleCostFunction({ inputCostPerM: 1, outputCostPerM: 5 }),
    ...(video ? { createUploader: () => new InlineMp4VideoUploader() } : {}),
});

export const MODEL_ENTRIES: Record<
    "GEMINI_3_FLASH_PREVIEW" | "MINISTRAL_8B" | "GPT_OSS_120B" | "MINIMAX_M3",
    ModelEntry
> = {
    GEMINI_3_FLASH_PREVIEW: haikuEntry(true),
    MINISTRAL_8B: haikuEntry(false),
    GPT_OSS_120B: haikuEntry(false),
    MINIMAX_M3: haikuEntry(true),
};

export const OPENROUTER_MODEL_ENTRIES: Record<"GEMINI_3_FLASH_PREVIEW" | "MINISTRAL_8B" | "GPT_OSS_120B", ModelEntry> =
    {
        GEMINI_3_FLASH_PREVIEW: haikuEntry(true),
        MINISTRAL_8B: haikuEntry(false),
        GPT_OSS_120B: haikuEntry(false),
    };
