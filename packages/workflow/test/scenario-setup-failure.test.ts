import { describe, expect, it } from "vitest";
import { scenarioSetupFailureResult } from "../src/scenario-setup-failure";

describe("scenarioSetupFailureResult", () => {
    it("produces a real verdict (never a missing-verdict / classification_error result)", () => {
        const result = scenarioSetupFailureResult({ slug: "some-test", message: "boom" });
        expect(result.verdict).toBeDefined();
        expect(result.verdict?.ran).toBe(false);
        expect(result.verdict?.isClientBug).toBe(false);
        expect(result.runSuccess).toBe(false);
        // The error text is carried as evidence so the cause is visible in the report.
        expect(result.verdict?.evidence[0]?.detail).toBe("boom");
    });

    it("categorizes a missing/unreachable preview as environment_failure", () => {
        const cases = [
            `SDK returned HTTP 404: Error parsing response: Unexpected token '<', "<html>`,
            "SDK returned HTTP 503: Error parsing response",
            "SDK call timed out after 90s - ensure your endpoint is reachable and responds quickly",
            "fetch failed",
            "Activity task timed out",
        ];
        for (const message of cases) {
            expect(scenarioSetupFailureResult({ slug: "t", message }).verdict?.category).toBe("environment_failure");
        }
    });

    it("categorizes a seeding (5xx) failure as scenario_issue", () => {
        const cases = [
            'SDK returned HTTP 500: Failed query: select "id" from "user_profiles" where "stytch_member_id" = $1',
            "SDK returned HTTP 500: canceling statement due to statement timeout",
            "SDK returned HTTP 500: auth sign-in failed for demo-admin+abc@autonoma.test",
        ];
        for (const message of cases) {
            expect(scenarioSetupFailureResult({ slug: "t", message }).verdict?.category).toBe("scenario_issue");
        }
    });

    it("defaults an unrecognized failure to environment_failure (conservative, not the PR's fault)", () => {
        expect(scenarioSetupFailureResult({ slug: "t", message: "something odd happened" }).verdict?.category).toBe(
            "environment_failure",
        );
    });
});
