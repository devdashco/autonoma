import type { UploadedVideo } from "@autonoma/ai";
import type { ModelMessage } from "ai";
import { MessageBuilder } from "../kernel";
import type { RunContext } from "./types";

export function buildReplayReviewMessages(context: RunContext, video: UploadedVideo | undefined): ModelMessage[] {
    return new MessageBuilder()
        .section("Test Plan", context.testPlanPrompt)
        .section("Test Case", `**Name:** ${context.testCaseName}`)
        .video(video, "The video above shows the complete replay recording.")
        .section("Step Summary", buildStepSummary(context))
        .closingPrompt(
            "The step summary above shows every step the replay engine executed. Decide whether the failure is due to outdated step definitions (`engine_error`) or a real application bug (`application_bug`), then submit your verdict.",
        )
        .build();
}

function buildStepSummary(context: RunContext): string {
    if (context.steps.length === 0) return "No steps were executed.";

    return context.steps
        .map((step) => {
            const output = step.output as Record<string, unknown> | undefined;
            const outcome = output?.outcome ?? "unknown";
            const hasScreenshots = step.screenshotBeforeKey != null || step.screenshotAfterKey != null;

            const lines = [
                `### Step ${step.order}: ${step.interaction}`,
                `- **Parameters**: ${JSON.stringify(step.params)}`,
                `- **Output**: ${JSON.stringify(output)}`,
                `- **Outcome**: ${outcome}`,
            ];
            if (hasScreenshots) {
                lines.push("- Screenshots available (use view_step_screenshot tool to inspect)");
            }
            return lines.join("\n");
        })
        .join("\n\n");
}
