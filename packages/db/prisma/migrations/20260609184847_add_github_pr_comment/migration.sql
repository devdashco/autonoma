-- CreateEnum
CREATE TYPE "github_pr_comment_kind" AS ENUM ('preview', 'runs');

-- CreateTable
CREATE TABLE "github_pr_comment" (
    "id" TEXT NOT NULL,
    "repo_full_name" TEXT NOT NULL,
    "pr_number" INTEGER NOT NULL,
    "kind" "github_pr_comment_kind" NOT NULL,
    "comment_id" TEXT,
    "head_sha" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_pr_comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_pr_comment_repo_full_name_pr_number_kind_key" ON "github_pr_comment"("repo_full_name", "pr_number", "kind");
