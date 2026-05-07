import type { ModelMessage } from "ai";

export interface GenerationStepData {
    order: number;
    interaction: string;
    params: unknown;
    output: unknown;
    screenshotBeforeKey?: string;
    screenshotAfterKey?: string;
}

/**
 * Everything the GenerationReviewer needs to render a prompt and run the
 * agent. Loaded once by GenerationContextLoader, then passed around as a
 * read-only value object.
 */
export interface GenerationContext {
    generationId: string;
    organizationId: string;
    /** What the execution agent self-reported. The reviewer's verdict overrides this. */
    selfReportedStatus: "success" | "failed" | "running" | "queued" | "pending";
    testPlanPrompt: string;
    conversation: ModelMessage[];
    reasoning?: string;
    videoUrl?: string;
    finalScreenshotKey?: string;
    steps: GenerationStepData[];
}
