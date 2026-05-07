import { type LanguageModel, MODEL_ENTRIES, ModelRegistry } from "@autonoma/ai";
import { db } from "@autonoma/db";
import { IssueReporter } from "@autonoma/issue-reporter";
import { logger as rootLogger } from "@autonoma/logger";
import type { CreateIssueFromGenerationReviewInput } from "@autonoma/workflow/activities";

let reporterSingleton: IssueReporter | undefined;
function getReporter(): IssueReporter {
    if (reporterSingleton == null) {
        const registry = new ModelRegistry({
            models: { GEMINI_3_FLASH_PREVIEW: MODEL_ENTRIES.GEMINI_3_FLASH_PREVIEW },
        });
        const model: LanguageModel = registry.getModel({ model: "GEMINI_3_FLASH_PREVIEW", tag: "bug-matcher" });
        reporterSingleton = IssueReporter.fromModel(model);
    }
    return reporterSingleton;
}

export async function createIssueFromGenerationReview(input: CreateIssueFromGenerationReviewInput): Promise<void> {
    const logger = rootLogger.child({
        name: "createIssueFromGenerationReview",
        generationId: input.generationId,
    });
    logger.info("Creating issue from generation review");

    const review = await db.generationReview.findUniqueOrThrow({
        where: { generationId: input.generationId },
        select: { id: true, organizationId: true },
    });

    await getReporter().reportFromGenerationVerdict({
        generationReviewId: review.id,
        verdict: input.verdict,
        organizationId: review.organizationId,
        skipBugCreation: input.skipBugCreation,
        resolveLinkContext: async () => {
            const generation = await db.testGeneration.findUniqueOrThrow({
                where: { id: input.generationId },
                select: {
                    snapshot: { select: { branchId: true } },
                    testPlan: { select: { testCaseId: true } },
                },
            });
            return {
                branchId: generation.snapshot.branchId,
                testCaseId: generation.testPlan.testCaseId,
            };
        },
    });

    logger.info("Issue creation finished");
}
