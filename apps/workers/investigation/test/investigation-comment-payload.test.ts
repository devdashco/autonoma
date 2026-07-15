import type { InvestigationTestResult, InvestigationVerdict } from "@autonoma/workflow/activities";
import { describe, expect, it } from "vitest";
import {
    buildInvestigationCommentPayload,
    type InvestigationCommentContext,
} from "../src/activities/investigation-comment-payload";

const context: InvestigationCommentContext = {
    prNumber: 42,
    commitSha: "e5d627abcdef",
    prUrl: "https://beta.autonoma.app/app/acme/pull-requests/42/",
    reportBaseUrl: "https://beta.autonoma.app/app/acme/pull-requests/42/snapshots/snap_1/investigation",
    previewUrl: "https://preview.example.com",
    assetBaseUrl: "https://beta.autonoma.app/github-comment/",
};

function verdict(category: string): InvestigationVerdict {
    return {
        category,
        isClientBug: category === "client_bug",
        ran: true,
        confidence: "high",
        headline: `${category} headline`,
        falsePositiveRisk: "low",
        whatHappened: "what happened",
        rootCause: "root cause",
        remediation: "do the fix",
        evidence: [{ source: "diff", detail: "the change", file: "app/x.ts", lines: "1-2", snippet: "- a\n+ b" }],
    };
}

function result(slug: string, category: string, extra: Partial<InvestigationTestResult> = {}): InvestigationTestResult {
    return { slug, plan: "", runSuccess: false, stepCount: 1, verdict: verdict(category), ...extra };
}

const noSign = async (): Promise<undefined> => undefined;

describe("buildInvestigationCommentPayload", () => {
    it("is critical, lists client bugs as rich findings, and signs their screenshots", async () => {
        const signed: string[] = [];
        const payload = await buildInvestigationCommentPayload(
            [result("csv-export", "client_bug", { finalScreenshotUrl: "s3://b/shot.png" }), result("ok", "passed")],
            context,
            async (url) => {
                signed.push(url);
                return `signed:${url}`;
            },
        );

        expect(payload.state).toBe("critical");
        expect(payload.bugs).toHaveLength(1);
        expect(payload.bugs[0]).toMatchObject({
            title: "client_bug headline",
            description: "what happened",
            remediation: "do the fix",
            screenshotUrl: "signed:s3://b/shot.png",
            evidence: [{ source: "diff", file: "app/x.ts", lines: "1-2", snippet: "- a\n+ b" }],
        });
        expect(payload.bugs[0]?.href).toContain("/investigation/csv-export");
        // A client bug carries a replay link (the run recording shows the failure).
        expect(payload.bugs[0]?.replayHref).toContain("/investigation/csv-export");
        expect(signed).toEqual(["s3://b/shot.png"]);
    });

    it("lists every finding type - client bugs, actionable issues, and engine artifacts - ordered by severity", async () => {
        const payload = await buildInvestigationCommentPayload(
            [
                result("engine", "engine_artifact"),
                result("scenario", "scenario_issue"),
                result("bug", "client_bug"),
                result("ok", "passed"),
            ],
            context,
            noSign,
        );

        // Critical (a client bug exists), but the actionable issue and engine artifact are still shown -
        // only the passed result is withheld. Client bug leads, then actionable, then informational.
        expect(payload.state).toBe("critical");
        expect(payload.bugs.map((bug) => bug.title)).toEqual([
            "client_bug headline",
            "scenario_issue headline",
            "engine_artifact headline",
        ]);
    });

    it("surfaces an engine artifact even when the run is otherwise healthy", async () => {
        const payload = await buildInvestigationCommentPayload(
            [result("engine", "engine_artifact"), result("ok", "passed")],
            context,
            noSign,
        );

        // No client bug and no actionable finding, so the state stays healthy - but the engine artifact
        // is still surfaced for transparency, while the passed result is not.
        expect(payload.state).toBe("healthy");
        expect(payload.bugs.map((bug) => bug.title)).toEqual(["engine_artifact headline"]);
    });

    it("is a warning when only actionable findings exist (no client bug)", async () => {
        const payload = await buildInvestigationCommentPayload(
            [result("scenario", "scenario_issue"), result("env", "environment_failure")],
            context,
            noSign,
        );

        expect(payload.state).toBe("warning");
        expect(payload.bugs).toHaveLength(2);
        // Warnings get no "Watch replay" button - the recording adds nothing for scenario/env/test issues.
        expect(payload.bugs.every((bug) => bug.replayHref == null)).toBe(true);
    });

    it("appends the scenario repair route (and client-factory change) to the remediation when diagnosed", async () => {
        const payload = await buildInvestigationCommentPayload(
            [
                result("integrations", "scenario_issue", {
                    scenarioDiagnosis: {
                        route: "recipe_and_sdk",
                        confidence: "high",
                        reasoning: "the factory has no handler for this model",
                        factoryIssue: "register a defineFactory for external_connectors",
                    },
                }),
            ],
            context,
            noSign,
        );

        const remediation = payload.bugs[0]?.remediation ?? "";
        expect(remediation).toContain("do the fix");
        expect(remediation).toContain("Repair route: `recipe_and_sdk`");
        expect(remediation).toContain("Client factory change: register a defineFactory for external_connectors");
    });

    it("is healthy when nothing is actionable", async () => {
        const payload = await buildInvestigationCommentPayload([result("ok", "passed")], context, noSign);

        expect(payload.state).toBe("healthy");
        expect(payload.bugs).toHaveLength(0);
    });

    it("adds the preview CTA only when a preview URL is present", async () => {
        const withPreview = await buildInvestigationCommentPayload([result("ok", "passed")], context, noSign);
        expect(withPreview.ctas.map((cta) => cta.label)).toEqual(["Open in Autonoma", "See preview"]);
        // "Open in Autonoma" lands on the PR overview page, not the investigation report.
        expect(withPreview.ctas[0]).toEqual({ label: "Open in Autonoma", href: context.prUrl });

        const withoutPreview = await buildInvestigationCommentPayload(
            [result("ok", "passed")],
            { ...context, previewUrl: undefined },
            noSign,
        );
        expect(withoutPreview.ctas.map((cta) => cta.label)).toEqual(["Open in Autonoma"]);
    });
});
