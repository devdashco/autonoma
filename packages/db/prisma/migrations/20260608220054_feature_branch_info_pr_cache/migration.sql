-- CreateEnum
CREATE TYPE "pull_request_cache_state" AS ENUM ('open', 'closed', 'merged');

-- AlterTable
ALTER TABLE "feature_branch_info" ADD COLUMN     "pr_author_login" TEXT,
ADD COLUMN     "pr_cached_at" TIMESTAMP(3),
ADD COLUMN     "pr_state" "pull_request_cache_state",
ADD COLUMN     "pr_title" TEXT,
ADD COLUMN     "pr_updated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "github_request_etag" (
    "installation_id" INTEGER NOT NULL,
    "request_key" TEXT NOT NULL,
    "etag" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_request_etag_pkey" PRIMARY KEY ("installation_id","request_key")
);

-- CreateIndex
CREATE INDEX "feature_branch_info_application_id_pr_cached_at_idx" ON "feature_branch_info"("application_id", "pr_cached_at");
