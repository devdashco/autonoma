import type { PrismaClient } from "@autonoma/db";
import { logger } from "@autonoma/logger";
import type { ReportedBug } from "../tools/report-bug-tool";

interface ReportBugDeps {
    db: PrismaClient;
    snapshotId: string;
    applicationId: string;
    organizationId: string;
}

/**
 * Records a bug surfaced by the diff resolution agent. Atomic: creates an
 * Issue, creates a Bug (no deduplication - one Bug per call), records the
 * test case as evidence, and quarantines the test case in the given snapshot.
 */
export async function reportBug(
    bug: ReportedBug,
    { db, snapshotId, applicationId, organizationId }: ReportBugDeps,
): Promise<void> {
    logger.info("Reporting bug found in diff resolution", {
        runId: bug.runId,
        slug: bug.slug,
        summary: bug.summary,
    });

    const testCase = await db.testCase.findFirst({
        where: { slug: bug.slug, applicationId },
        select: { id: true },
    });

    if (testCase == null) {
        logger.warn("Test case not found for reported bug", { slug: bug.slug });
        return;
    }

    const runReview = await db.runReview.findUnique({
        where: { runId: bug.runId },
        select: { id: true },
    });

    if (runReview == null) {
        logger.warn("Run review not found for reported bug", { runId: bug.runId });
        return;
    }

    await db.$transaction(async (tx) => {
        const created = await tx.bug.create({
            data: {
                title: bug.summary,
                description: buildBugDescription(bug),
                severity: "medium",
                applicationId,
                organizationId,
                evidence: {
                    create: { testCaseId: testCase.id },
                },
            },
            select: { id: true },
        });

        await tx.issue.create({
            data: {
                runReviewId: runReview.id,
                kind: "application_bug",
                severity: "medium",
                title: bug.summary,
                description: buildBugDescription(bug),
                bugId: created.id,
                organizationId,
            },
        });

        await tx.testCaseQuarantine.create({
            data: {
                snapshotId,
                testCaseId: testCase.id,
                reason: "application_bug",
                bugId: created.id,
                organizationId,
            },
        });
    });
}

function buildBugDescription(bug: ReportedBug): string {
    const sections = [bug.details];
    if (bug.affectedFiles.length > 0) {
        sections.push(`## Affected files\n${bug.affectedFiles.map((f) => `- ${f}`).join("\n")}`);
    }
    sections.push(`## Suggested fix\n${bug.fixPrompt}`);
    return sections.join("\n\n");
}
