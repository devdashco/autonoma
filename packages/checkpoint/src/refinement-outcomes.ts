import type { GenerationReviewVerdict, GenerationStatus } from "@autonoma/db";

export interface TestCaseLite {
    id: string;
    name: string;
    slug: string;
}

export interface OutcomeValidated {
    planId: string;
    testCase: TestCaseLite;
    generationId: string;
}

export interface OutcomeFailedAtGeneration {
    planId: string;
    testCase: TestCaseLite;
    generationId: string;
    generationStatus: GenerationStatus;
    verdictKind?: GenerationReviewVerdict;
    reviewReasoning?: string;
}

export interface OutcomeAwaiting {
    planId: string;
    testCase: TestCaseLite;
}

export interface RefinementIterationOutcomes {
    validated: OutcomeValidated[];
    failedAtGeneration: OutcomeFailedAtGeneration[];
    awaiting: OutcomeAwaiting[];
}

export interface RefinementGenerationRow {
    id: string;
    testPlanId: string;
    status: GenerationStatus;
    createdAt: Date;
    generationReview: { verdict: GenerationReviewVerdict | null; reasoning: string | null; status: string } | null;
}

/**
 * Buckets each input plan's outcome as of a cutoff, from the plan's latest
 * generation. A generation passing its review is the definition of "validated" -
 * there is no replay step.
 */
export function computeIterationOutcomes({
    inputs,
    cutoff,
    generations,
}: {
    inputs: Array<{ planId: string; testCase: TestCaseLite }>;
    cutoff: Date;
    generations: RefinementGenerationRow[];
}): RefinementIterationOutcomes {
    const outcomes: RefinementIterationOutcomes = {
        validated: [],
        failedAtGeneration: [],
        awaiting: [],
    };

    for (const input of inputs) {
        const gen = latestBeforeCutoff(
            generations.filter((g) => g.testPlanId === input.planId),
            cutoff,
        );
        if (gen == null) {
            outcomes.awaiting.push({ planId: input.planId, testCase: input.testCase });
            continue;
        }

        const review = gen.generationReview;
        const genSuccess =
            gen.status === "success" && review != null && review.status === "completed" && review.verdict === "success";

        if (genSuccess) {
            outcomes.validated.push({
                planId: input.planId,
                testCase: input.testCase,
                generationId: gen.id,
            });
            continue;
        }

        outcomes.failedAtGeneration.push({
            planId: input.planId,
            testCase: input.testCase,
            generationId: gen.id,
            generationStatus: gen.status,
            verdictKind: review?.verdict ?? undefined,
            reviewReasoning: review?.reasoning ?? undefined,
        });
    }

    return outcomes;
}

function latestBeforeCutoff<T extends { createdAt: Date }>(rows: T[], cutoff: Date): T | undefined {
    let best: T | undefined;
    for (const row of rows) {
        if (row.createdAt.getTime() > cutoff.getTime()) continue;
        if (best == null || row.createdAt.getTime() > best.createdAt.getTime()) best = row;
    }
    return best;
}
