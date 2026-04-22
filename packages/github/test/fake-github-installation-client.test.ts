import { describe, expect, test } from "vitest";
import { FakeGitHubInstallationClient } from "../src/fake/fake-github-installation-client";

describe("FakeGitHubInstallationClient.getCommit", () => {
    test("returns commit with registered details", async () => {
        const client = new FakeGitHubInstallationClient();
        client.addRepository({
            id: 1,
            name: "repo",
            fullName: "org/repo",
            commits: ["sha-main-1", "sha-main-2"],
        });
        client.setCommitDetails("org/repo", "sha-main-2", {
            message: "Fix bug in login flow",
            authorLogin: "alice",
        });

        const commit = await client.getCommit(1, "sha-main-2");

        expect(commit).toEqual({
            sha: "sha-main-2",
            message: "Fix bug in login flow",
            authorLogin: "alice",
        });
    });

    test("returns empty message when no details registered", async () => {
        const client = new FakeGitHubInstallationClient();
        client.addRepository({
            id: 2,
            name: "repo",
            fullName: "org/repo",
            commits: ["sha-main-1"],
        });

        const commit = await client.getCommit(2, "sha-main-1");

        expect(commit.sha).toBe("sha-main-1");
        expect(commit.message).toBe("");
        expect(commit.authorLogin).toBeUndefined();
    });

    test("finds commits on PR branches", async () => {
        const client = new FakeGitHubInstallationClient();
        client.addRepository({
            id: 3,
            name: "repo",
            fullName: "org/repo",
            commits: ["base-1"],
        });
        client.addPullRequest("org/repo", {
            number: 1,
            title: "Feature PR",
            headRef: "feature",
            baseSha: "base-1",
            commits: ["feat-sha-1", "feat-sha-2"],
        });
        client.setCommitDetails("org/repo", "feat-sha-2", {
            message: "Add feature",
            authorLogin: "bob",
        });

        const commit = await client.getCommit(3, "feat-sha-2");

        expect(commit).toEqual({
            sha: "feat-sha-2",
            message: "Add feature",
            authorLogin: "bob",
        });
    });

    test("throws when SHA is unknown", async () => {
        const client = new FakeGitHubInstallationClient();
        client.addRepository({
            id: 4,
            name: "repo",
            fullName: "org/repo",
            commits: ["known"],
        });

        await expect(client.getCommit(4, "unknown")).rejects.toThrow(/Commit "unknown" not found/);
    });

    test("throws when repo is unknown", async () => {
        const client = new FakeGitHubInstallationClient();

        await expect(client.getCommit(999, "sha")).rejects.toThrow(/Repository with ID 999 not found/);
    });

    test("setCommitDetails throws when SHA does not exist on any branch", () => {
        const client = new FakeGitHubInstallationClient();
        client.addRepository({
            id: 5,
            name: "repo",
            fullName: "org/repo",
            commits: ["real"],
        });

        expect(() => client.setCommitDetails("org/repo", "ghost", { message: "nope" })).toThrow(
            /Commit "ghost" not found on any branch of org\/repo/,
        );
    });
});
