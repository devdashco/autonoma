import { FakeGitHubInstallationClient } from "@autonoma/github";
import { describe, expect, it } from "vitest";
import type { BugReport } from "../../src/tools/bug-found-tool";

const bugReport: BugReport = {
    slug: "checkout-flow",
    testName: "Checkout flow",
    summary: "Payment button is unresponsive",
    detailedExplanation: "The payment button does not respond to clicks after form submission.",
    affectedFiles: ["src/components/PaymentButton.tsx"],
    fixPrompt: "Check the onClick handler in PaymentButton.tsx",
};

describe("reportBug", () => {
    it("creates a GitHub issue with the bug report", async () => {
        const { reportBug } = await import("../../src/callbacks/report-bug");

        const fakeClient = new FakeGitHubInstallationClient();
        fakeClient.addRepository({ id: 1001, name: "repo", fullName: "org/repo" });

        await reportBug(bugReport, {
            repoId: 1001,
            headSha: "abc12345def",
            githubClient: fakeClient,
        });

        expect(fakeClient.createdIssues).toHaveLength(1);
        const issue = fakeClient.createdIssues[0]!;
        expect(issue.repoId).toBe(1001);
        expect(issue.title).toBe("[Autonoma] Bug detected: Payment button is unresponsive");
        expect(issue.body).toContain("Payment button is unresponsive");
        expect(issue.labels).toEqual(["autonoma", "bug"]);
    });
});
