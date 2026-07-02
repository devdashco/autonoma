-- Additive only: add a nullable branch_id to bug, its FK, and the branch-scoped
-- read indexes. No data is wiped, backfilled, or dropped; pre-existing bugs keep
-- branch_id = NULL and are abandoned by the branch-scoped reads landing in a later
-- slice. The denormalized application_id and its indexes are retained.

-- AlterTable
ALTER TABLE "bug" ADD COLUMN     "branch_id" TEXT;

-- CreateIndex
CREATE INDEX "bug_branch_id_status_idx" ON "bug"("branch_id", "status");

-- CreateIndex
CREATE INDEX "bug_branch_id_last_seen_at_idx" ON "bug"("branch_id", "last_seen_at");

-- AddForeignKey
ALTER TABLE "bug" ADD CONSTRAINT "bug_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
