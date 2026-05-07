import { type LanguageModel, MODEL_ENTRIES, ModelRegistry } from "@autonoma/ai";
import { db } from "@autonoma/db";
import { IssueReporter } from "@autonoma/issue-reporter";
import { logger as rootLogger } from "@autonoma/logger";
import type { CreateIssueFromRunReviewInput } from "@autonoma/workflow/activities";

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

export async function createIssueFromRunReview(input: CreateIssueFromRunReviewInput): Promise<void> {
    const logger = rootLogger.child({ name: "createIssueFromRunReview", runId: input.runId });
    logger.info("Creating issue from run review");

    const review = await db.runReview.findUniqueOrThrow({
        where: { runId: input.runId },
        select: { id: true, organizationId: true },
    });

    await getReporter().reportFromRunVerdict({
        runReviewId: review.id,
        verdict: input.verdict,
        organizationId: review.organizationId,
        skipBugCreation: input.skipBugCreation,
        resolveLinkContext: async () => {
            const run = await db.run.findUniqueOrThrow({
                where: { id: input.runId },
                select: {
                    assignment: {
                        select: {
                            testCaseId: true,
                            snapshot: { select: { branchId: true } },
                        },
                    },
                },
            });
            return {
                branchId: run.assignment.snapshot.branchId,
                testCaseId: run.assignment.testCaseId,
            };
        },
    });

    logger.info("Issue creation finished");
}
