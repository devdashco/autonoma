-- The merged analysis pipeline's SHADOW run record - an isolated, droppable island (mirrors
-- investigation_report). It records one shadow run's verdict, its per-test findings (JSON), and the diffs-job
-- comparison (JSON). Written only in shadow mode; never user-facing. It FKs only OUTWARD (branch_snapshot /
-- organization, cascade) and nothing in the core app FKs into it, so retiring the shadow machinery at cutover
-- is a clean DROP TABLE.

-- CreateTable
CREATE TABLE "analysis_shadow_run" (
    "snapshot_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "test_count" INTEGER NOT NULL DEFAULT 0,
    "client_bug_count" INTEGER NOT NULL DEFAULT 0,
    "findings" JSONB,
    "deployed" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT NOT NULL,

    CONSTRAINT "analysis_shadow_run_pkey" PRIMARY KEY ("snapshot_id")
);

-- AddForeignKey
ALTER TABLE "analysis_shadow_run" ADD CONSTRAINT "analysis_shadow_run_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "branch_snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_shadow_run" ADD CONSTRAINT "analysis_shadow_run_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
