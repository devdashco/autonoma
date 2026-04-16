import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@autonoma/db";
import type { DiffsAgentInput, ExistingSkillInfo, ExistingTestInfo } from "@autonoma/diffs";
import { TestDirectory } from "@autonoma/diffs";
import type { GitHubApp } from "@autonoma/github";
import { logger } from "@autonoma/logger";
import type { TestSuiteInfo } from "@autonoma/test-updates";

const execFileAsync = promisify(execFile);

export interface BranchData {
    applicationId: string;
    organizationId: string;
    repoId: number;
    fullName: string;
    installationId: string;
}

export async function loadBranchData(branchId: string, githubApp: GitHubApp): Promise<BranchData> {
    const branch = await db.branch.findUniqueOrThrow({
        where: { id: branchId },
        select: {
            applicationId: true,
            application: {
                select: {
                    organizationId: true,
                    githubRepositoryId: true,
                },
            },
        },
    });

    if (branch.application.githubRepositoryId == null) {
        throw new Error(`No GitHub repository linked to application ${branch.applicationId}`);
    }

    const installation = await db.gitHubInstallation.findUnique({
        where: { organizationId: branch.application.organizationId },
    });

    if (installation == null) {
        throw new Error(`No GitHub installation found for organization ${branch.application.organizationId}`);
    }

    const client = await githubApp.getInstallationClient(installation.installationId);
    const repo = await client.getRepository(branch.application.githubRepositoryId);

    return {
        applicationId: branch.applicationId,
        organizationId: branch.application.organizationId,
        repoId: branch.application.githubRepositoryId,
        fullName: repo.fullName,
        installationId: String(installation.installationId),
    };
}

function mapTestSuiteToContext(suiteInfo: TestSuiteInfo): {
    existingTests: ExistingTestInfo[];
    existingSkills: ExistingSkillInfo[];
} {
    const existingTests: ExistingTestInfo[] = [];
    for (const testCase of suiteInfo.testCases) {
        if (testCase.plan == null) continue;
        existingTests.push({
            id: testCase.id,
            name: testCase.name,
            slug: testCase.slug,
            prompt: testCase.plan.prompt,
        });
    }

    const existingSkills: ExistingSkillInfo[] = [];
    for (const skill of suiteInfo.skills) {
        if (skill.plan == null) continue;
        existingSkills.push({
            id: skill.id,
            name: skill.name,
            slug: skill.slug,
            description: skill.description,
            content: skill.plan.content,
        });
    }

    return { existingTests, existingSkills };
}

async function buildDiffAnalysis(
    repoDir: string,
    headSha: string,
    baseSha: string,
): Promise<{ affectedFiles: string[]; summary: string }> {
    const { stdout: nameOnly } = await execFileAsync("git", ["diff", `${baseSha}..${headSha}`, "--name-only"], {
        cwd: repoDir,
        maxBuffer: 10 * 1024 * 1024,
    });

    const affectedFiles = nameOnly
        .trim()
        .split("\n")
        .filter((f) => f.length > 0);

    const { stdout: logOutput } = await execFileAsync("git", ["log", `${baseSha}..${headSha}`, "--format=%s"], {
        cwd: repoDir,
    });

    const summary = logOutput.trim();

    logger.info("Built diff analysis", { affectedFiles: affectedFiles.length, summary: summary.slice(0, 200) });
    return { affectedFiles, summary };
}

export async function loadDiffsContext(
    suiteInfo: TestSuiteInfo,
    repoDir: string,
    headSha: string,
    baseSha: string,
): Promise<{ input: DiffsAgentInput; testDirectory: TestDirectory }> {
    const { existingTests, existingSkills } = mapTestSuiteToContext(suiteInfo);

    const [analysis, testDirectory] = await Promise.all([
        buildDiffAnalysis(repoDir, headSha, baseSha),
        TestDirectory.create({ workingDirectory: repoDir, tests: existingTests, skills: existingSkills }),
    ]);

    logger.info("Loaded diffs context", {
        existingTests: existingTests.length,
        existingSkills: existingSkills.length,
    });

    return {
        input: { analysis, existingTests, existingSkills },
        testDirectory,
    };
}
