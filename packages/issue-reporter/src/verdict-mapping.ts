import type { IssueCategory } from "@autonoma/db";
import type { GenerationVerdictKind, ReplayVerdictKind } from "@autonoma/types";

/**
 * Map a GenerationReview verdict to the legacy `IssueCategory` enum used by
 * the Issue/Bug pipeline.
 *
 * `success` returns `undefined` — the caller skips issue creation entirely.
 * `agent_limitation` and `plan_mismatch` both fold into the existing
 * `agent_error` category until the ActionAgent introduces richer semantics.
 */
export function mapGenerationVerdictToIssueCategory(verdict: GenerationVerdictKind): IssueCategory | undefined {
    if (verdict === "success") return undefined;
    if (verdict === "application_bug") return "application_bug";
    return "agent_error";
}

export function mapReplayVerdictToIssueCategory(verdict: ReplayVerdictKind): IssueCategory {
    if (verdict === "application_bug") return "application_bug";
    return "agent_error";
}
