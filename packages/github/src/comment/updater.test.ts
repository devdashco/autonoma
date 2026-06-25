import { describe, expect, it } from "vitest";
import { payloadBuilder } from "./payload";
import type { GitHubCommentClient, GitHubCommentStore } from "./types";
import { postOrUpdateCommentOnGithub } from "./updater";

function makeStore(state: { commentId: string | null; headSha: string | null } | null): GitHubCommentStore {
    return {
        async getState() {
            return state;
        },
        async setCommentId(_repoFullName, _prNumber, commentId) {
            if (state != null) state.commentId = commentId;
        },
    };
}

function makeClient(calls: string[]): GitHubCommentClient {
    return {
        async postComment() {
            calls.push("post");
            return "new";
        },
        async updateComment(_repoFullName, commentId) {
            calls.push(`update:${commentId}`);
        },
        async deleteComment(_repoFullName, commentId) {
            calls.push(`delete:${commentId}`);
        },
    };
}

describe("postOrUpdate", () => {
    it("refuses to overwrite a newer commit comment with an older strict update", async () => {
        const calls: string[] = [];

        const result = await postOrUpdateCommentOnGithub({
            client: makeClient(calls),
            store: makeStore({ commentId: "123", headSha: "newer-sha" }),
            repoFullName: "autonoma/app",
            prNumber: 7,
            lastCommitSha: "older-sha",
            payload: payloadBuilder({ state: "healthy", prNumber: 7 }),
        });

        expect(result.status).toBe("stale_skipped");
        expect(calls).toEqual([]);
    });

    it("updates the existing comment for the active commit", async () => {
        const calls: string[] = [];

        const result = await postOrUpdateCommentOnGithub({
            client: makeClient(calls),
            store: makeStore({ commentId: "123", headSha: "same-sha" }),
            repoFullName: "autonoma/app",
            prNumber: 7,
            lastCommitSha: "same-sha",
            payload: payloadBuilder({ state: "running", prNumber: 7 }),
        });

        expect(result.status).toBe("updated");
        expect(calls).toEqual(["update:123"]);
    });

    it("allows a new-head pending update before the environment row is rewritten", async () => {
        const calls: string[] = [];

        const result = await postOrUpdateCommentOnGithub({
            client: makeClient(calls),
            store: makeStore({ commentId: "123", headSha: "previous-sha" }),
            repoFullName: "autonoma/app",
            prNumber: 7,
            lastCommitSha: "new-sha",
            staleGuard: "allow-new-head",
            payload: payloadBuilder({ state: "running", prNumber: 7 }),
        });

        expect(result.status).toBe("updated");
        expect(calls).toEqual(["update:123"]);
    });

    it("repost deletes the previous comment then posts a fresh one", async () => {
        const calls: string[] = [];
        const state: { commentId: string | null; headSha: string | null } = {
            commentId: "123",
            headSha: "same-sha",
        };

        const result = await postOrUpdateCommentOnGithub({
            client: makeClient(calls),
            store: makeStore(state),
            repoFullName: "autonoma/app",
            prNumber: 7,
            lastCommitSha: "same-sha",
            mode: "repost",
            payload: payloadBuilder({ state: "healthy", prNumber: 7 }),
        });

        expect(result.status).toBe("posted");
        expect(calls).toEqual(["delete:123", "post"]);
        expect(state.commentId).toBe("new");
    });

    it("repost with no previous comment just posts", async () => {
        const calls: string[] = [];

        const result = await postOrUpdateCommentOnGithub({
            client: makeClient(calls),
            store: makeStore(null),
            repoFullName: "autonoma/app",
            prNumber: 7,
            lastCommitSha: "sha",
            mode: "repost",
            payload: payloadBuilder({ state: "healthy", prNumber: 7 }),
        });

        expect(result.status).toBe("posted");
        expect(calls).toEqual(["post"]);
    });

    it("repost updates the existing comment in place when deleting it fails", async () => {
        const calls: string[] = [];
        const client: GitHubCommentClient = {
            ...makeClient(calls),
            async deleteComment() {
                throw new Error("boom");
            },
        };

        const result = await postOrUpdateCommentOnGithub({
            client,
            store: makeStore({ commentId: "123", headSha: "same-sha" }),
            repoFullName: "autonoma/app",
            prNumber: 7,
            lastCommitSha: "same-sha",
            mode: "repost",
            payload: payloadBuilder({ state: "healthy", prNumber: 7 }),
        });

        // A failed delete leaves the old comment visible, so posting a fresh one would duplicate it.
        // Fall back to editing the existing comment in place - never two comments at once.
        expect(result.status).toBe("updated");
        expect(calls).toEqual(["update:123"]);
    });

    it("repost posts a fresh comment when both deleting and updating fail", async () => {
        const calls: string[] = [];
        const client: GitHubCommentClient = {
            ...makeClient(calls),
            async deleteComment() {
                calls.push("delete:fail");
                throw new Error("delete boom");
            },
            async updateComment() {
                calls.push("update:fail");
                throw new Error("update boom");
            },
        };

        const result = await postOrUpdateCommentOnGithub({
            client,
            store: makeStore({ commentId: "123", headSha: "same-sha" }),
            repoFullName: "autonoma/app",
            prNumber: 7,
            lastCommitSha: "same-sha",
            mode: "repost",
            payload: payloadBuilder({ state: "healthy", prNumber: 7 }),
        });

        // Both delete and update failed - the comment is genuinely unreachable, so a fresh post is safe.
        expect(result.status).toBe("posted");
        expect(calls).toEqual(["delete:fail", "update:fail", "post"]);
    });

    it("strict stale guard skips a repost without touching the client", async () => {
        const calls: string[] = [];

        const result = await postOrUpdateCommentOnGithub({
            client: makeClient(calls),
            store: makeStore({ commentId: "123", headSha: "newer-sha" }),
            repoFullName: "autonoma/app",
            prNumber: 7,
            lastCommitSha: "older-sha",
            mode: "repost",
            payload: payloadBuilder({ state: "healthy", prNumber: 7 }),
        });

        expect(result.status).toBe("stale_skipped");
        expect(calls).toEqual([]);
    });

    it("treats an empty-string commentId as absent and updates the stored comment", async () => {
        const calls: string[] = [];

        const result = await postOrUpdateCommentOnGithub({
            client: makeClient(calls),
            store: makeStore({ commentId: "123", headSha: "same-sha" }),
            repoFullName: "autonoma/app",
            prNumber: 7,
            lastCommitSha: "same-sha",
            commentId: "",
            payload: payloadBuilder({ state: "running", prNumber: 7 }),
        });

        // "" must not skip the update and post a fresh comment - that would orphan #123.
        expect(result.status).toBe("updated");
        expect(calls).toEqual(["update:123"]);
    });

    it("treats an empty-string commentId as absent and reposts over the stored comment", async () => {
        const calls: string[] = [];
        const state: { commentId: string | null; headSha: string | null } = {
            commentId: "123",
            headSha: "same-sha",
        };

        const result = await postOrUpdateCommentOnGithub({
            client: makeClient(calls),
            store: makeStore(state),
            repoFullName: "autonoma/app",
            prNumber: 7,
            lastCommitSha: "same-sha",
            commentId: "",
            mode: "repost",
            payload: payloadBuilder({ state: "healthy", prNumber: 7 }),
        });

        // The stored #123 is deleted before the fresh post - not left orphaned.
        expect(result.status).toBe("posted");
        expect(calls).toEqual(["delete:123", "post"]);
        expect(state.commentId).toBe("new");
    });
});
