import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel, VideoProcessor } from "@autonoma/ai";
import { buildCodebaseTools, type Codebase } from "@autonoma/codebase";
import { type Logger, logger as rootLogger } from "@autonoma/logger";
import { type GenerationVerdict, generationVerdictSchema } from "@autonoma/types";
import type { ToolSet } from "ai";
import {
    buildScreenshotTools,
    buildVerdictTool,
    runReviewAgent,
    type ScreenshotLoader,
    tryUploadVideo,
    type VideoDownloader,
} from "../kernel";
import { buildGenerationReviewMessages } from "./message-builder";
import type { GenerationContext } from "./types";

const SYSTEM_PROMPT = readFileSync(join(import.meta.dirname, "review-prompt.md"), "utf-8");

export interface GenerationReviewerDeps {
    model: LanguageModel;
    evidenceLoader: ScreenshotLoader & VideoDownloader;
    videoProcessor?: VideoProcessor;
    codebase?: Codebase;
}

export interface GenerationReviewResult {
    generationId: string;
    verdict: GenerationVerdict | undefined;
}

/**
 * Runs the review LLM loop against a loaded GenerationContext and returns a
 * verdict. Does not persist anything - persistence is GenerationReviewPersister's
 * concern, and Issue/Bug creation is the IssueReporter's concern.
 */
export class GenerationReviewer {
    private readonly logger: Logger;

    constructor(private readonly deps: GenerationReviewerDeps) {
        this.logger = rootLogger.child({ name: this.constructor.name });
    }

    async review(context: GenerationContext): Promise<GenerationReviewResult> {
        this.logger.info("Starting generation review", {
            generationId: context.generationId,
            stepCount: context.steps.length,
            selfReportedStatus: context.selfReportedStatus,
            hasCodebase: this.deps.codebase != null,
        });

        const video = await tryUploadVideo(context.videoUrl, this.deps.evidenceLoader, this.deps.videoProcessor);
        const messages = buildGenerationReviewMessages(context, video);
        const tools = this.buildTools(context);

        const { verdict } = await runReviewAgent<GenerationVerdict>({
            model: this.deps.model,
            systemPrompt: SYSTEM_PROMPT,
            tools,
            messages,
        });

        this.logger.info("Generation review completed", {
            verdict: verdict?.verdict,
            generationId: context.generationId,
        });

        return { generationId: context.generationId, verdict };
    }

    private buildTools(context: GenerationContext): ToolSet {
        const tools: ToolSet = {
            ...buildScreenshotTools({
                screenshotLoader: this.deps.evidenceLoader,
                steps: context.steps,
                finalScreenshotKey: context.finalScreenshotKey,
            }),
            submit_verdict: buildVerdictTool(generationVerdictSchema, {
                description:
                    "Submit your final classification of this generation. Call this exactly once when you're ready to commit to a verdict.",
            }),
        };

        if (this.deps.codebase != null) {
            Object.assign(tools, buildCodebaseTools(this.deps.codebase));
        }

        return tools;
    }
}
