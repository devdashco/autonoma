import type {
    AutonomaCommentBug,
    AutonomaCommentCta,
    AutonomaCommentPayload,
    AutonomaCommentState,
} from "@autonoma/github/comment";
import type { InvestigationTestResult } from "@autonoma/workflow/activities";

/** Verdict categories that warrant action (a "warning" state) when there are no outright client bugs. */
const ACTIONABLE_CATEGORIES = new Set(["scenario_issue", "environment_failure", "outdated_test", "bad_test"]);

export interface InvestigationCommentContext {
    prNumber: number;
    commitSha: string;
    /** The in-app report base URL for this snapshot (".../investigation"); per-finding links append the slug. */
    reportBaseUrl: string;
    /** The preview environment URL for the branch, if deployed. */
    previewUrl?: string;
    /** Base URL the comment's status/CTA image assets are served from. */
    assetBaseUrl: string;
}

/**
 * Build the shared GitHub-comment payload from the investigation's classified results. Client bugs make the
 * comment UNHEALTHY; otherwise actionable findings (scenario/env/test issues) make it a WARNING; a clean run is
 * HEALTHY. Each shown finding becomes a rich bug collapsible. Screenshots are signed via the injected signer.
 */
export async function buildInvestigationCommentPayload(
    results: InvestigationTestResult[],
    context: InvestigationCommentContext,
    signScreenshot: (s3Url: string) => Promise<string | undefined>,
): Promise<AutonomaCommentPayload> {
    const clientBugs = results.filter((result) => result.verdict?.category === "client_bug");
    const actionables = results.filter((result) => ACTIONABLE_CATEGORIES.has(result.verdict?.category ?? ""));

    const state: AutonomaCommentState =
        clientBugs.length > 0 ? "critical" : actionables.length > 0 ? "warning" : "healthy";
    const shown = clientBugs.length > 0 ? clientBugs : actionables;

    const bugs = await Promise.all(shown.map((result) => toBug(result, context, signScreenshot)));

    const ctas: AutonomaCommentCta[] = [{ label: "Open in Autonoma", href: context.reportBaseUrl }];
    if (context.previewUrl != null && context.previewUrl !== "") {
        ctas.push({ label: "See preview", href: context.previewUrl });
    }

    return {
        state,
        prNumber: context.prNumber,
        headline: "",
        commitRef: context.commitSha.slice(0, 7),
        assetBaseUrl: context.assetBaseUrl,
        ctas,
        services: [],
        addons: [],
        warnings: [],
        details: [],
        bugs,
    };
}

async function toBug(
    result: InvestigationTestResult,
    context: InvestigationCommentContext,
    signScreenshot: (s3Url: string) => Promise<string | undefined>,
): Promise<AutonomaCommentBug> {
    const verdict = result.verdict;
    const findingUrl = `${context.reportBaseUrl}/${encodeURIComponent(result.slug)}`;
    const screenshotUrl =
        result.finalScreenshotUrl != null ? await signScreenshot(result.finalScreenshotUrl) : undefined;
    return {
        title: verdict?.headline ?? result.slug,
        href: findingUrl,
        replayHref: findingUrl,
        screenshotUrl,
        description: verdict?.whatHappened,
        remediation: verdict?.remediation,
        evidence: (verdict?.evidence ?? []).map((item) => ({
            source: item.source,
            detail: item.detail,
            file: item.file,
            lines: item.lines,
            snippet: item.snippet,
        })),
        previewHref: context.previewUrl,
    };
}
