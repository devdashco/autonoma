import { logger } from "@autonoma/logger";
import { type Tool, type ToolSet, tool } from "ai";
import type { ZodType } from "zod";
import { z } from "zod";

export interface ScreenshotLoader {
    loadScreenshot(key: string): Promise<Buffer>;
}

export interface ReviewStepScreenshots {
    order: number;
    screenshotBeforeKey?: string;
    screenshotAfterKey?: string;
}

export interface BuildScreenshotToolsParams {
    screenshotLoader: ScreenshotLoader;
    steps: ReviewStepScreenshots[];
    finalScreenshotKey?: string;
}

/**
 * The two screenshot-inspection tools every reviewer agent gets.
 * Returns a ToolSet you can spread into a wider tool registry.
 */
export function buildScreenshotTools({
    screenshotLoader,
    steps,
    finalScreenshotKey,
}: BuildScreenshotToolsParams): ToolSet {
    const stepScreenshotKeys = new Map<string, string>();
    for (const step of steps) {
        if (step.screenshotBeforeKey != null) {
            stepScreenshotKeys.set(`${step.order}-before`, step.screenshotBeforeKey);
        }
        if (step.screenshotAfterKey != null) {
            stepScreenshotKeys.set(`${step.order}-after`, step.screenshotAfterKey);
        }
    }

    return {
        view_step_screenshot: tool({
            description:
                "View the screenshot taken before or after a specific step. Use this to visually inspect what the application looked like at a particular point during execution.",
            inputSchema: z.object({
                stepOrder: z.number().describe("The step number to view (0-indexed)"),
                timing: z
                    .enum(["before", "after"])
                    .describe("Whether to view the screenshot before or after the step executed"),
            }),
            execute: async ({ stepOrder, timing }: { stepOrder: number; timing: "before" | "after" }) => {
                const key = stepScreenshotKeys.get(`${stepOrder}-${timing}`);
                if (key == null) {
                    return { found: false as const, stepOrder, timing };
                }

                logger.info("Loading step screenshot", { stepOrder, timing });
                const buffer = await screenshotLoader.loadScreenshot(key);

                return { found: true as const, stepOrder, timing, base64: buffer.toString("base64") };
            },
            toModelOutput: ({ output }) => {
                if (!output.found) {
                    return {
                        type: "text",
                        value: `No ${output.timing} screenshot available for step ${output.stepOrder}`,
                    };
                }

                return {
                    type: "content",
                    value: [
                        { type: "text", text: `Screenshot for step ${output.stepOrder} (${output.timing}):` },
                        { type: "image-data", data: output.base64, mediaType: "image/png" },
                    ],
                };
            },
        }),

        view_final_screenshot: tool({
            description:
                "View the final screenshot - what the application looked like when the last step finished executing.",
            inputSchema: z.object({}),
            execute: async () => {
                if (finalScreenshotKey == null) {
                    return { found: false as const };
                }

                logger.info("Loading final screenshot");
                const buffer = await screenshotLoader.loadScreenshot(finalScreenshotKey);

                return { found: true as const, base64: buffer.toString("base64") };
            },
            toModelOutput: ({ output }) => {
                if (!output.found) {
                    return { type: "text", value: "No final screenshot available" };
                }

                return {
                    type: "content",
                    value: [
                        { type: "text", text: "Final screenshot:" },
                        { type: "image-data", data: output.base64, mediaType: "image/png" },
                    ],
                };
            },
        }),
    };
}

/**
 * Build the terminal `submit_verdict`-style tool. Generic over the verdict schema
 * so each reviewer can supply its own Zod shape (generation has 4 outcomes,
 * replay has 2).
 */
export function buildVerdictTool<S extends ZodType>(
    schema: S,
    options: { name?: string; description?: string } = {},
): Tool {
    return tool({
        description:
            options.description ??
            "Submit your final verdict. Call this once you have analyzed the execution and reached a conclusion.",
        inputSchema: schema,
    });
}
