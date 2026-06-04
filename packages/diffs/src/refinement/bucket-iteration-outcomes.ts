import { type RefinementTrigger, db } from "@autonoma/db";
import { type Logger, logger as rootLogger } from "@autonoma/logger";
import type { GenerationOutcomeFailure, RunOutcomeFailure } from "@autonoma/workflow/activities";

/**
 * The shared bucketing logic for one refinement iteration's plan outcomes.
 *
 * For each plan that fed into the iteration, this resolves the latest
 * generation and run in the iteration's snapshot, joins their reviews, and
 * splits them into three buckets:
 *
 *  - `validatedTestCaseIds` - the run succeeded.
 *  - `failuresAtGeneration` - generation (or its review) failed.
 *  - `failuresAtReplay`     - generation succeeded but the run (or its review) failed.
 *
 * The bucketing invariants ("an input plan with no generation is a fatal
 * violation"; "a passing generation must have a run") are load-bearing for both
 * callers, so this helper is the single source of truth: the `analyzeResults`
 * activity wraps it, and healing capture reuses it to rebuild the activity
 * input from an iteration id when the original input is no longer in hand.
 */
export interface BucketedIterationOutcomes {
    validatedTestCaseIds: string[];
    failuresAtGeneration: GenerationOutcomeFailure[];
    failuresAtReplay: RunOutcomeFailure[];
    snapshotId: string;
    loopId: string;
    triggeredBy: RefinementTrigger;
    iterationNumber: number;
}

/** Bucket an iteration's plan outcomes. See {@link BucketedIterationOutcomes}. */
export async function bucketIterationOutcomes(
    iterationId: string,
    logger?: Logger,
): Promise<BucketedIterationOutcomes> {
    const log = logger ?? rootLogger.child({ name: "bucketIterationOutcomes" });

    const iteration = await db.refinementIteration.findUniqueOrThrow({
        where: { id: iterationId },
        select: {
            number: true,
            inputs: { select: { planId: true } },
            loop: { select: { id: true, snapshotId: true, triggeredBy: true } },
        },
    });

    const planIds = iteration.inputs.map((i) => i.planId);
    const snapshotId = iteration.loop.snapshotId;
    const meta = {
        snapshotId,
        loopId: iteration.loop.id,
        triggeredBy: iteration.loop.triggeredBy,
        iterationNumber: iteration.number,
    };

    if (planIds.length === 0) {
        log.info("Iteration has no input plans; nothing to bucket");
        return { validatedTestCaseIds: [], failuresAtGeneration: [], failuresAtReplay: [], ...meta };
    }

    const generations = await db.testGeneration.findMany({
        where: { testPlanId: { in: planIds }, snapshotId },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            status: true,
            testPlan: {
                select: {
                    id: true,
                    prompt: true,
                    testCase: { select: { id: true, slug: true, name: true } },
                },
            },
            generationReview: {
                select: { id: true, verdict: true, reasoning: true, status: true },
            },
        },
    });

    const latestGenByPlan = new Map<string, (typeof generations)[number]>();
    for (const gen of generations) {
        if (!latestGenByPlan.has(gen.testPlan.id)) latestGenByPlan.set(gen.testPlan.id, gen);
    }

    const runs = await db.run.findMany({
        where: {
            planId: { in: planIds },
            assignment: { snapshotId },
        },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            status: true,
            planId: true,
            assignment: { select: { testCaseId: true } },
            runReview: { select: { id: true, verdict: true, reasoning: true, status: true } },
        },
    });

    const latestRunByPlan = new Map<string, (typeof runs)[number]>();
    for (const run of runs) {
        if (run.planId != null && !latestRunByPlan.has(run.planId)) latestRunByPlan.set(run.planId, run);
    }

    const validatedTestCaseIds: string[] = [];
    const failuresAtGeneration: GenerationOutcomeFailure[] = [];
    const failuresAtReplay: RunOutcomeFailure[] = [];

    for (const planId of planIds) {
        const generation = latestGenByPlan.get(planId);

        if (generation == null) {
            log.fatal("Input plan has no generation in this snapshot - invariant violated", { planId });
            throw new Error(
                `bucketIterationOutcomes: no TestGeneration found for planId=${planId} in snapshot=${snapshotId} ` +
                    `(iteration=${iterationId}). The refinement loop's pre-fire step must have created ` +
                    `one before this activity ran; investigate the upstream pipeline (runGenerationPipelineWorkflow).`,
            );
        }

        const review = generation.generationReview;
        const isGenSuccess =
            generation.status === "success" && review?.status === "completed" && review.verdict === "success";

        if (!isGenSuccess) {
            failuresAtGeneration.push({
                bucket: "failed_at_generation",
                failureKey: generation.id,
                testCaseId: generation.testPlan.testCase.id,
                testCaseSlug: generation.testPlan.testCase.slug,
                testCaseName: generation.testPlan.testCase.name,
                planId: generation.testPlan.id,
                planPrompt: generation.testPlan.prompt,
                sourceId: generation.id,
                sourceStatus: generation.status,
                verdictKind: (review?.verdict ?? undefined) as GenerationOutcomeFailure["verdictKind"],
                reviewReasoning: review?.reasoning ?? undefined,
                generationReviewId: review?.id ?? undefined,
            });
            continue;
        }

        const run = latestRunByPlan.get(planId);
        if (run == null) {
            log.fatal("Generation succeeded but no run exists for plan - invariant violated", {
                planId,
                testGenerationId: generation.id,
            });
            throw new Error(
                `bucketIterationOutcomes: TestGeneration ${generation.id} for planId=${planId} succeeded but no ` +
                    `Run exists for that plan in snapshot=${snapshotId}. The refinement loop's pre-fire step ` +
                    `must have created one via prepareRunsForGenerations; investigate runGenerationPipelineWorkflow.`,
            );
        }

        if (run.status === "success") {
            validatedTestCaseIds.push(run.assignment.testCaseId);
            continue;
        }

        const runReview = run.runReview;
        failuresAtReplay.push({
            bucket: "failed_at_replay",
            failureKey: run.id,
            testCaseId: run.assignment.testCaseId,
            testCaseSlug: generation.testPlan.testCase.slug,
            testCaseName: generation.testPlan.testCase.name,
            planId: generation.testPlan.id,
            planPrompt: generation.testPlan.prompt,
            sourceId: run.id,
            sourceStatus: run.status,
            verdictKind: (runReview?.verdict ?? undefined) as RunOutcomeFailure["verdictKind"],
            reviewReasoning: runReview?.reasoning ?? undefined,
            runReviewId: runReview?.id ?? undefined,
        });
    }

    log.info("Bucketed iteration outcomes", {
        extra: {
            validated: validatedTestCaseIds.length,
            failuresAtGeneration: failuresAtGeneration.length,
            failuresAtReplay: failuresAtReplay.length,
        },
    });

    return { validatedTestCaseIds, failuresAtGeneration, failuresAtReplay, ...meta };
}
