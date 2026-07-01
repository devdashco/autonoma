-- Investigation agent posts its own PR comment, kept separate from the diffs "runs" comment.
ALTER TYPE "github_pr_comment_kind" ADD VALUE IF NOT EXISTS 'investigation';
