import type { InvestigationTestResult, InvestigationVerdict } from "./activities";

/**
 * Build the result for a shadow test whose `scenario up` failed before the app could be exercised. Mirrors the
 * diffs generation path (mark the setup failed and skip the run) - we do NOT launch a browser or invoke the
 * classifier when provisioning never produced a usable environment. Crucially, we attach a real verdict with a
 * provisioning category so the report attributes the failure to the environment/scenario, NOT to a
 * `classification_error` (a missing-verdict result renders as "classification error", which is how these
 * `scenario up` failures were being mislabeled and hidden).
 *
 * The category split is a deterministic heuristic keyed off the SDK error: a 5xx from the seeding call means
 * the endpoint responded but provisioning the data failed (a recipe/scenario problem), while a 404 / timeout /
 * unreachable endpoint means the preview deployment itself is missing (an environment problem). When unclear we
 * default to `environment_failure`, the more conservative "not the PR's fault" bucket.
 */
export function scenarioSetupFailureResult(input: { slug: string; message: string }): InvestigationTestResult {
    const category = categorizeScenarioSetupFailure(input.message);
    const isEnvironment = category === "environment_failure";
    const verdict: InvestigationVerdict = {
        category,
        isClientBug: false,
        ran: false,
        confidence: "high",
        planFidelity: "diverged",
        headline: isEnvironment
            ? "Scenario setup failed: the preview environment was unavailable, so the test never ran"
            : "Scenario setup failed: seeding the test data errored, so the test never ran",
        falsePositiveRisk: "None - the test never executed against the app, so this cannot be attributed to the PR.",
        whatHappened: `scenario up failed before the browser was launched: ${input.message}`,
        rootCause: isEnvironment
            ? "The preview deployment / SDK endpoint was missing or unreachable during provisioning."
            : "The scenario seeding call failed, so the required test data was never provisioned.",
        remediation: isEnvironment
            ? "Restore or redeploy the PR preview and confirm the SDK endpoint is reachable, then re-run."
            : "Fix the failing scenario recipe/seed for this app (see the error), then re-run.",
        evidence: [{ source: "run", detail: input.message }],
    };
    return { slug: input.slug, plan: "", runSuccess: false, stepCount: 0, verdict };
}

/**
 * A 5xx from the seeding call means the SDK endpoint is up but provisioning the data failed - a scenario/recipe
 * problem. A 404 / unreachable / timed-out endpoint means the preview deployment itself is missing - an
 * environment problem. Anything else defaults to `environment_failure`.
 */
function categorizeScenarioSetupFailure(message: string): "environment_failure" | "scenario_issue" {
    const normalized = message.toLowerCase();
    const isSeedFailure =
        normalized.includes("http 500") ||
        normalized.includes("failed query") ||
        normalized.includes("statement timeout") ||
        normalized.includes("sign-in failed");
    return isSeedFailure ? "scenario_issue" : "environment_failure";
}
