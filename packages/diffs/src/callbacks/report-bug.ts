import type { GitHubInstallationClient } from "@autonoma/github";
import { logger } from "@autonoma/logger";
import type { BugReport } from "../tools/bug-found-tool";

interface ReportBugDeps {
    repoId: number;
    headSha: string;
    githubClient: GitHubInstallationClient;
}

export async function reportBug(report: BugReport, { repoId, headSha, githubClient }: ReportBugDeps): Promise<void> {
    logger.info("Reporting bug", { summary: report.summary, repoId });

    const body = formatBugIssueBody(report, headSha);
    const title = `[Autonoma] Bug detected: ${report.summary}`;
    const issue = await githubClient.createIssue(repoId, title, body, ["autonoma", "bug"]);

    logger.info("GitHub issue created", { issueNumber: issue.number, issueUrl: issue.url });
}

function formatBugIssueBody(report: BugReport, headSha: string): string {
    return `## Bug Report (Automated)

**Detected by Autonoma's diff analysis agent on commit \`${headSha.slice(0, 8)}\`.**

### Summary
${report.summary}

### Detailed Explanation
${report.detailedExplanation}

### Test Case
- **Slug:** \`${report.slug}\`
- **Test Name:** ${report.testName}

### Affected Files
${report.affectedFiles.map((f) => `- \`${f}\``).join("\n")}

### Suggested Fix
\`\`\`
${report.fixPrompt}
\`\`\`

---
*This issue was automatically created by [Autonoma](https://autonoma.app).*`;
}
