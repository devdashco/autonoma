import { describe, expect, it } from "vitest";
import { FakeGitHubInstallationClient } from "./fake-github-installation-client";

describe("FakeGitHubInstallationClient comments", () => {
    it("stores and updates PR comments in memory", async () => {
        const client = new FakeGitHubInstallationClient();
        client.addRepository({ id: 1, name: "app", fullName: "autonoma/app" });

        const commentId = await client.postComment("autonoma/app", 7, "first body");
        await client.updateComment("autonoma/app", commentId, "updated body");

        expect(client.comments).toEqual([
            { id: commentId, repoFullName: "autonoma/app", prNumber: 7, body: "updated body" },
        ]);
    });

    it("deletes PR comments idempotently", async () => {
        const client = new FakeGitHubInstallationClient();
        client.addRepository({ id: 1, name: "app", fullName: "autonoma/app" });

        const commentId = await client.postComment("autonoma/app", 7, "body");
        await client.deleteComment("autonoma/app", commentId);
        expect(client.comments).toEqual([]);

        // Second delete is a no-op, matching GitHub's 404-tolerant contract.
        await client.deleteComment("autonoma/app", commentId);

        // The deleted comment can no longer be updated.
        await expect(client.updateComment("autonoma/app", commentId, "new body")).rejects.toThrow("not found");
    });
});
