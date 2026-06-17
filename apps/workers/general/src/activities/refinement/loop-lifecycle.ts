import type { Prisma } from "@autonoma/db";
import { type RefinementTrigger, db } from "@autonoma/db";
import { type Logger, logger as rootLogger } from "@autonoma/logger";
import { TestSuiteUpdater } from "@autonoma/test-updates";
import type {
    FinishErroredRefinementIterationsInput,
    FinishRefinementIterationInput,
    FinishRefinementLoopInput,
    InitRefinementLoopInput,
    InitRefinementLoopOutput,
    MarkRefinementIterationRunningInput,
} from "@autonoma/workflow/activities";

/**
 * Bootstraps a refinement loop. In one transaction:
 *
 *   - Resolves orgId / appId from the snapshot.
 *   - Creates the RefinementLoop row (status=running).
 *   - Creates iteration 1 (status=pending).
 *   - Seeds iteration 1's RefinementIterationInput rows by trigger (see
 *     {@link seedFirstIterationPlanIds}).
 *
 * `runFirstIterationPipeline` lets the workflow skip the iter-1 generation
 * pipeline child when iter 1 has nothing to generate; `firstIterationCandidateCount`
 * lets it run the Healing agent on a candidates-only first turn rather than
 * converging immediately.
 *
 * Invariant this depends on: at trigger time, the seed set is exactly the plans
 * that need refinement. Maintained by the upstream flows that trigger the loop:
 *
 *   - Diffs: the diffs analysis step replays every affected test against the
 *     diff, so the affected tests' committed plans (the ones whose replays ran)
 *     are exactly iter 1's scope; iter 1 is a replay-only turn that buckets
 *     those runs directly. The Step 1 new-test candidates ride alongside as the
 *     first turn's `add_test` proposals.
 *   - Onboarding: `AddTest` changes during snapshot setup queue pending gens
 *     for every test the loop should validate; `addJob`'s per-test-case dedup
 *     prevents stale pending rows from accumulating.
 *
 * If a future code path creates pending generations on the snapshot outside
 * these flows (e.g. a retry mechanism, a manual user-triggered regeneration,
 * a concurrent diffs trigger), this invariant breaks and the loop will sweep
 * those plans into its scope. Anything new that queues pending gens needs to
 * either coordinate with the loop's lifecycle or use a different status enum
 * value to remain invisible.
 */
export async function initRefinementLoop(input: InitRefinementLoopInput): Promise<InitRefinementLoopOutput> {
    const logger = rootLogger.child({ name: "initRefinementLoop" });
    logger.info("Initializing refinement loop", { triggeredBy: input.triggeredBy });

    // Snapshot-level metadata (org, branch) is immutable for a snapshot's lifetime;
    // resolving it via TestSuiteUpdater (out of transaction) avoids re-doing the
    // snapshot -> branch -> organization join we'd otherwise inline here.
    const updater = await TestSuiteUpdater.continueUpdateBySnapshot({
        db,
        snapshotId: input.snapshotId,
    });

    return await db.$transaction(async (tx) => {
        const planIds = await seedFirstIterationPlanIds(tx, input.snapshotId, input.triggeredBy, logger);

        // Candidates only exist for the diffs trigger (Step 1 proposals); onboarding
        // has none. They are still pending at init time - reconciliation runs in the
        // first-turn apply tail, after the Healing agent decides them.
        const firstIterationCandidateCount =
            input.triggeredBy === "diffs"
                ? await tx.testCandidate.count({ where: { snapshotId: input.snapshotId, status: "pending" } })
                : 0;

        const loop = await tx.refinementLoop.create({
            data: {
                snapshotId: input.snapshotId,
                organizationId: updater.organizationId,
                triggeredBy: input.triggeredBy,
                status: "running",
            },
            select: { id: true },
        });

        const iteration = await tx.refinementIteration.create({
            data: { loopId: loop.id, number: 1, status: "pending" },
            select: { id: true },
        });

        if (planIds.length > 0) {
            await tx.refinementIterationInput.createMany({
                data: planIds.map((planId) => ({ iterationId: iteration.id, planId })),
            });
        }

        // Diffs iter 1 analyzes replays that already ran upstream, so it never
        // fires the generation pipeline. Onboarding fires it for its pending gens.
        const runFirstIterationPipeline = input.triggeredBy === "onboarding" && planIds.length > 0;

        logger.info("Refinement loop initialized", {
            loopId: loop.id,
            iterationId: iteration.id,
            organizationId: updater.organizationId,
            extra: { inputCount: planIds.length, runFirstIterationPipeline, firstIterationCandidateCount },
        });

        return {
            loopId: loop.id,
            organizationId: updater.organizationId,
            firstIterationId: iteration.id,
            runFirstIterationPipeline,
            firstIterationCandidateCount,
        };
    });
}

/**
 * Seed iteration 1's input plan ids by trigger.
 *
 *   - Diffs: the affected tests' committed plans, taken from the replays the
 *     diffs analysis step already ran. Only affected tests with a plan-linked
 *     run are seeded; one without a run has neither a generation nor a run and
 *     would trip the bucketer's "neither" invariant.
 *   - Onboarding: the snapshot's pending generations (the work the loop must
 *     finish before activating the snapshot).
 */
async function seedFirstIterationPlanIds(
    tx: Prisma.TransactionClient,
    snapshotId: string,
    triggeredBy: RefinementTrigger,
    logger: Logger,
): Promise<string[]> {
    if (triggeredBy === "diffs") return await seedDiffsReplayPlanIds(tx, snapshotId, logger);
    return await seedOnboardingPendingPlanIds(tx, snapshotId);
}

/** Diffs: the plans the affected-test replays ran against (deduped). */
async function seedDiffsReplayPlanIds(
    tx: Prisma.TransactionClient,
    snapshotId: string,
    logger: Logger,
): Promise<string[]> {
    const affected = await tx.affectedTest.findMany({
        where: { snapshotId, runId: { not: null } },
        select: { run: { select: { planId: true } } },
    });

    const planIds = [...new Set(affected.map((a) => a.run?.planId).filter((id): id is string => id != null))];
    logger.info("Seeded iteration 1 from affected-test replays", {
        extra: { affectedWithRuns: affected.length, planIds: planIds.length },
    });
    return planIds;
}

/** Onboarding: the snapshot's pending generations, one input per plan. */
async function seedOnboardingPendingPlanIds(tx: Prisma.TransactionClient, snapshotId: string): Promise<string[]> {
    const pending = await tx.testGeneration.findMany({
        where: { snapshotId, status: "pending" },
        select: { testPlanId: true },
    });

    // Assert addJob's per-test-case invariant: at most one pending generation per
    // testPlan in a snapshot. If this fires, something queued generations outside
    // the documented flows and the loop's "pending = my scope" semantics break.
    const planIds = pending.map((g) => g.testPlanId);
    const seenPlanIds = new Set<string>();
    const duplicatePlanIds = new Set<string>();
    for (const planId of planIds) {
        if (seenPlanIds.has(planId)) duplicatePlanIds.add(planId);
        else seenPlanIds.add(planId);
    }
    if (duplicatePlanIds.size > 0) {
        throw new Error(
            `Multiple pending generations exist for the same plan(s) in snapshot ${snapshotId}: ` +
                `${[...duplicatePlanIds].join(", ")}. addJob's per-test-case dedup should make this impossible; ` +
                `investigate which path is queueing generations outside the expected flows.`,
        );
    }

    return planIds;
}

/** Transitions an iteration to running. Called at the top of the iter body. */
export async function markRefinementIterationRunning(input: MarkRefinementIterationRunningInput): Promise<void> {
    const logger = rootLogger.child({ name: "markRefinementIterationRunning" });
    logger.info("Marking iteration as running");
    await db.refinementIteration.update({
        where: { id: input.iterationId },
        data: { status: "running" },
    });
}

export async function finishRefinementIteration(input: FinishRefinementIterationInput): Promise<void> {
    await db.refinementIteration.update({
        where: { id: input.iterationId },
        data: { status: "completed", finishedAt: new Date() },
    });
}

export async function finishErroredRefinementIterations(input: FinishErroredRefinementIterationsInput): Promise<void> {
    await db.refinementIteration.updateMany({
        where: {
            loopId: input.loopId,
            status: { in: ["pending", "running"] },
            finishedAt: null,
        },
        data: { status: "completed", finishedAt: new Date() },
    });
}

export async function finishRefinementLoop(input: FinishRefinementLoopInput): Promise<void> {
    await db.refinementLoop.update({
        where: { id: input.loopId },
        data: { status: input.status, finishedAt: new Date() },
    });
}
