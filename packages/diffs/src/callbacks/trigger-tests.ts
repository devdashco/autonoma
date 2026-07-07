import type { BillingService } from "@autonoma/billing";
import type { ApplicationArchitecture, PrismaClient } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";
import { RegenerateSteps, TestSuiteUpdater } from "@autonoma/test-updates";
import type { AffectedReason } from "../agents/diffs/affected-test";

export interface PrepareAffectedTestsParams {
    db: PrismaClient;
    snapshotId: string;
    applicationId: string;
    organizationId: string;
    billingService: BillingService;
}

export interface AffectedTestSpec {
    slug: string;
    affectedReason: AffectedReason;
    reasoning: string;
}

export interface PreparedGenerationResult {
    generationId: string;
    slug: string;
    architecture: ApplicationArchitecture;
}

/**
 * Regenerates each affected test whose slug resolves to a plan-linked assignment
 * in the snapshot, and links a matching AffectedTest row. Regeneration goes
 * through the canonical path: applying a `RegenerateSteps` change queues a
 * pending generation from the test's committed plan (via the generation manager,
 * which dedupes any existing pending generation for the test case) - there is no
 * replay, and a generation passing its review is the definition of "validated".
 * Slugs without a corresponding test case, without a plan-linked assignment, or
 * whose billing check fails are skipped silently.
 *
 * The generations are created `pending` and non-shadow, so the refinement loop's
 * iteration 1 seeds itself from the snapshot's pending generations and generates
 * them alongside the tests the diffs agent authored.
 */
export async function prepareAffectedTestGenerations(
    affectedTests: AffectedTestSpec[],
    params: PrepareAffectedTestsParams,
): Promise<PreparedGenerationResult[]> {
    const logger = rootLogger.child({ name: "prepareAffectedTestGenerations", snapshotId: params.snapshotId });
    logger.info("Preparing generations for affected tests", { count: affectedTests.length });

    const { db, snapshotId, applicationId, organizationId, billingService } = params;
    const slugs = affectedTests.map((t) => t.slug);

    const testCases = await db.testCase.findMany({
        where: { slug: { in: slugs }, applicationId },
        select: {
            id: true,
            name: true,
            slug: true,
            application: { select: { architecture: true } },
        },
    });
    const testCaseBySlug = new Map(testCases.map((tc) => [tc.slug, tc]));

    // Only affected tests with a plan-linked assignment can be regenerated:
    // `RegenerateSteps` resolves the committed plan from the assignment, so one
    // without a plan would throw. Resolve them in a single batched lookup.
    const assignments = await db.testCaseAssignment.findMany({
        where: { snapshotId, testCaseId: { in: testCases.map((tc) => tc.id) }, planId: { not: null } },
        select: { testCaseId: true },
    });
    const planLinkedTestCaseIds = new Set(assignments.map((a) => a.testCaseId));

    interface RegenerableTest {
        slug: string;
        testCaseId: string;
        architecture: ApplicationArchitecture;
        affectedReason: AffectedReason;
        reasoning: string;
    }

    const regenerable: RegenerableTest[] = [];
    for (const affected of affectedTests) {
        const testCase = testCaseBySlug.get(affected.slug);
        if (testCase == null) {
            logger.warn("Test case not found for slug", { slug: affected.slug, applicationId });
            continue;
        }
        if (!planLinkedTestCaseIds.has(testCase.id)) {
            logger.warn("Test case has no plan-linked assignment in this snapshot; skipping", {
                slug: affected.slug,
                testCaseId: testCase.id,
                snapshotId,
            });
            continue;
        }
        regenerable.push({
            slug: affected.slug,
            testCaseId: testCase.id,
            architecture: testCase.application.architecture,
            affectedReason: affected.affectedReason,
            reasoning: affected.reasoning,
        });
    }

    if (regenerable.length === 0) {
        logger.info("No regenerable tests found");
        return [];
    }

    // Check billing for all generations at once.
    const sampleArchitecture = regenerable[0]!.architecture;
    try {
        await billingService.checkCreditsGate(organizationId, regenerable.length, sampleArchitecture);
    } catch (error) {
        logger.error("Billing credits check failed for batch", error, {
            organizationId,
            generationCount: regenerable.length,
        });
        return [];
    }

    // Queue a pending generation per affected test, deduct credits, and link the
    // AffectedTest row.
    const updater = await TestSuiteUpdater.continueUpdateBySnapshot({ db, snapshotId, organizationId });
    const results: PreparedGenerationResult[] = [];

    for (const test of regenerable) {
        const generationId = await updater.apply(new RegenerateSteps({ testCaseId: test.testCaseId }));

        logger.info("Generation record created", {
            generationId,
            slug: test.slug,
            testCaseId: test.testCaseId,
        });

        try {
            await billingService.deductCreditsForGeneration(generationId, {
                organizationId,
                architecture: test.architecture,
            });
        } catch (error) {
            logger.error("Failed to deduct credits for generation", error, { generationId, slug: test.slug });
            await db.testGeneration.update({ where: { id: generationId }, data: { status: "failed" } });
            continue;
        }

        await db.affectedTest.upsert({
            where: { snapshotId_testCaseId: { snapshotId, testCaseId: test.testCaseId } },
            create: {
                snapshotId,
                testCaseId: test.testCaseId,
                organizationId,
                affectedReason: test.affectedReason,
                reasoning: test.reasoning,
                generationId,
            },
            update: {
                affectedReason: test.affectedReason,
                reasoning: test.reasoning,
                generationId,
            },
        });

        results.push({
            generationId,
            slug: test.slug,
            architecture: test.architecture,
        });
    }

    logger.info("Generations prepared", { total: affectedTests.length, prepared: results.length });
    return results;
}
