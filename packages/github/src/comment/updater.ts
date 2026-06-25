import { logger as rootLogger } from "@autonoma/logger";
import { renderMarkdown } from "./markdown";
import type { PostOrUpdateCommentInput, PostOrUpdateCommentResult } from "./types";

export async function postOrUpdateCommentOnGithub(input: PostOrUpdateCommentInput): Promise<PostOrUpdateCommentResult> {
    if (input.store.runExclusive == null) return runPostOrUpdate(input);
    return input.store.runExclusive(input.repoFullName, input.prNumber, () => runPostOrUpdate(input));
}

async function runPostOrUpdate(input: PostOrUpdateCommentInput): Promise<PostOrUpdateCommentResult> {
    const logger = rootLogger.child({ name: "postOrUpdateCommentOnGithub" });
    const stored = await input.store.getState(input.repoFullName, input.prNumber);

    if (input.staleGuard !== "allow-new-head" && stored?.headSha != null && stored.headSha !== input.lastCommitSha) {
        logger.info("Skipping stale PR comment update", {
            repoFullName: input.repoFullName,
            prNumber: input.prNumber,
            storedHeadSha: stored.headSha,
            incomingHeadSha: input.lastCommitSha,
        });
        return { status: "stale_skipped", storedHeadSha: stored.headSha, incomingHeadSha: input.lastCommitSha };
    }

    const body = renderMarkdown(input.payload);
    // Normalize an empty-string commentId to absent so it falls back to the stored id below;
    // otherwise the `!== ""` guards skip the update/delete and we orphan the stored comment.
    const providedCommentId = input.commentId != null && input.commentId !== "" ? input.commentId : undefined;
    const existingCommentId = providedCommentId ?? stored?.commentId ?? null;

    if (input.mode === "repost" && existingCommentId != null && existingCommentId !== "") {
        // Delete-first so two comments are never visible at once.
        try {
            await input.client.deleteComment(input.repoFullName, existingCommentId);
            logger.info("Deleted previous PR comment before reposting", {
                repoFullName: input.repoFullName,
                prNumber: input.prNumber,
                commentId: existingCommentId,
            });
            return postFreshComment(input, body);
        } catch (err) {
            // A failed delete means the old comment is most likely still visible (the client
            // contract resolves a 404 rather than throwing, so this is a transient/permission
            // failure, not an already-gone comment). Posting a fresh one now would leave two
            // comments at once - the exact duplicate this whole path guards against. Fall through
            // to the update-in-place path below, which edits the existing comment instead and only
            // posts fresh if that update also fails.
            logger.warn("Failed to delete previous PR comment; updating it in place to avoid a duplicate", {
                repoFullName: input.repoFullName,
                prNumber: input.prNumber,
                commentId: existingCommentId,
                err,
            });
        }
    }

    if (existingCommentId != null && existingCommentId !== "") {
        try {
            await input.client.updateComment(input.repoFullName, existingCommentId, body);
            await input.store.setCommentId(input.repoFullName, input.prNumber, existingCommentId, input.lastCommitSha);
            logger.info("Updated PR comment", {
                repoFullName: input.repoFullName,
                prNumber: input.prNumber,
                commentId: existingCommentId,
            });
            return { status: "updated", commentId: existingCommentId, body };
        } catch (err) {
            // The stored comment was likely deleted on GitHub (or we lost permissions).
            // Fall through and post a fresh one, overwriting the stale stored id below.
            logger.warn("Failed to update existing PR comment; posting a fresh one", {
                repoFullName: input.repoFullName,
                prNumber: input.prNumber,
                commentId: existingCommentId,
                err,
            });
        }
    }

    return postFreshComment(input, body);
}

async function postFreshComment(input: PostOrUpdateCommentInput, body: string): Promise<PostOrUpdateCommentResult> {
    const logger = rootLogger.child({ name: "postOrUpdateCommentOnGithub" });
    const postedCommentId = await input.client.postComment(input.repoFullName, input.prNumber, body);
    await input.store.setCommentId(input.repoFullName, input.prNumber, postedCommentId, input.lastCommitSha);
    logger.info("Posted PR comment", {
        repoFullName: input.repoFullName,
        prNumber: input.prNumber,
        commentId: postedCommentId,
    });
    return { status: "posted", commentId: postedCommentId, body };
}
