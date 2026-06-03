import { db } from "@autonoma/db";
import { type GitHubApp, OctokitGitHubApp } from "@autonoma/github";
import { TestSuiteUpdater } from "@autonoma/test-updates";
import { TemporalGenerationProvider } from "@autonoma/test-updates/temporal";
import { env } from "./env";

/** Build a GitHub App client from this worker's env credentials. */
export function createGithubApp(): GitHubApp {
    return new OctokitGitHubApp({
        appId: env.GITHUB_APP_ID,
        privateKey: env.GITHUB_APP_PRIVATE_KEY,
        webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
        appSlug: env.GITHUB_APP_SLUG,
    });
}

export async function createDiffsServices(snapshotId: string) {
    const githubApp = createGithubApp();

    const jobProvider = new TemporalGenerationProvider();
    const updater = await TestSuiteUpdater.continueUpdateBySnapshot({ db, snapshotId, jobProvider });

    return { githubApp, updater };
}
