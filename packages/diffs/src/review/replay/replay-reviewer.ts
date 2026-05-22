import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel, VideoProcessor } from "@autonoma/ai";
import { type Logger, logger as rootLogger } from "@autonoma/logger";
import { type ReplayVerdict, replayVerdictSchema } from "@autonoma/types";
import type { ToolSet } from "ai";
import { buildRepoTools, type Codebase } from "../../codebase";
import {
    buildScreenshotTools,
    buildVerdictTool,
    runReviewAgent,
    type ScreenshotLoader,
    tryUploadVideo,
    type VideoDownloader,
} from "../kernel";
import { buildReplayReviewMessages } from "./message-builder";
import type { RunContext } from "./types";

const SYSTEM_PROMPT = readFileSync(join(import.meta.dirname, "review-prompt.md"), "utf-8");

export interface ReplayReviewerDeps {
    model: LanguageModel;
    evidenceLoader: ScreenshotLoader & VideoDownloader;
    videoProcessor?: VideoProcessor;
    codebase?: Codebase;
}

export interface ReplayReviewResult {
    runId: string;
    verdict: ReplayVerdict | undefined;
}

export class ReplayReviewer {
    private readonly logger: Logger;

    constructor(private readonly deps: ReplayReviewerDeps) {
        this.logger = rootLogger.child({ name: this.constructor.name });
    }

    async review(context: RunContext): Promise<ReplayReviewResult> {
        this.logger.info("Starting replay review", {
            runId: context.runId,
            stepCount: context.steps.length,
            hasCodebase: this.deps.codebase != null,
        });

        const video = await tryUploadVideo(context.videoS3Key, this.deps.evidenceLoader, this.deps.videoProcessor);
        const messages = buildReplayReviewMessages(context, video);
        const tools = this.buildTools(context);

        const { verdict } = await runReviewAgent<ReplayVerdict>({
            model: this.deps.model,
            systemPrompt: SYSTEM_PROMPT,
            tools,
            messages,
        });

        this.logger.info("Replay review completed", { verdict: verdict?.verdict, runId: context.runId });

        return { runId: context.runId, verdict };
    }

    private buildTools(context: RunContext): ToolSet {
        const tools: ToolSet = {
            ...buildScreenshotTools({
                screenshotLoader: this.deps.evidenceLoader,
                steps: context.steps,
                finalScreenshotKey: context.finalScreenshotKey,
            }),
            submit_verdict: buildVerdictTool(replayVerdictSchema),
        };

        if (this.deps.codebase != null) {
            Object.assign(tools, buildRepoTools(this.deps.codebase));
        }

        return tools;
    }
}
