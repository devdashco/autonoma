import type { CostCollector, CostRecord } from "@autonoma/ai";

/**
 * Aggregated view of every metered LLM call in a {@link CostCollector}.
 *
 * Cost is reported in **microdollars** (the native unit of `CostRecord`) so the
 * summary stays integral and matches what `AiCostRecord` persists. This is the
 * single, shared log shape for every non-persisting diffs flow (analysis,
 * healing) - the fields and units are identical everywhere.
 */
export interface SessionCostSummary extends Omit<CostRecord, "tag" | "model"> {
    /** Number of LLM calls metered into the session. */
    callCount: number;
}

/**
 * Roll a {@link CostCollector}'s records up into a single {@link SessionCostSummary}.
 *
 * Non-persisting flows log this object so their cost telemetry shares one shape
 * and one unit. Persisting flows (the reviewers) write `AiCostRecord` rows
 * instead and do not use this helper.
 */
export function summarizeSessionCost(costCollector: CostCollector): SessionCostSummary {
    return costCollector.getRecords().reduce<SessionCostSummary>(
        (acc, record) => ({
            callCount: acc.callCount + 1,
            costMicrodollars: acc.costMicrodollars + record.costMicrodollars,
            inputTokens: acc.inputTokens + record.inputTokens,
            outputTokens: acc.outputTokens + record.outputTokens,
            reasoningTokens: acc.reasoningTokens + record.reasoningTokens,
            cacheReadTokens: acc.cacheReadTokens + record.cacheReadTokens,
        }),
        {
            callCount: 0,
            costMicrodollars: 0,
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cacheReadTokens: 0,
        },
    );
}
