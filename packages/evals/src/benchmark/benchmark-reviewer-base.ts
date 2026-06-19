import { MODEL_ENTRIES, ModelRegistry, ObjectGenerator } from "@autonoma/ai";
import { logger as rootLogger } from "@autonoma/logger";
import type { z } from "zod";

export class BenchmarkReviewer<TVerdict> {
    private readonly logger = rootLogger.child({ name: this.constructor.name });
    private readonly generator: ObjectGenerator<TVerdict>;

    constructor(config: { schema: z.ZodType<TVerdict>; systemPrompt: string }) {
        const registry = new ModelRegistry({
            models: { reviewer: MODEL_ENTRIES.GEMINI_3_FLASH_PREVIEW },
        });
        const model = registry.getModel({ model: "reviewer", tag: "benchmark-reviewer" });
        this.generator = new ObjectGenerator({ model, systemPrompt: config.systemPrompt, schema: config.schema });
    }

    protected async review(userMessage: string): Promise<TVerdict> {
        this.logger.info("Running benchmark review");
        const result = await this.generator.generate({ userPrompt: userMessage });
        this.logger.info("Review complete");
        return result;
    }
}
