-- CreateTable
CREATE TABLE "investigation_quarantine" (
    "id" TEXT NOT NULL,
    "report_snapshot_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" TEXT NOT NULL,

    CONSTRAINT "investigation_quarantine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investigation_quarantine_report_snapshot_id_idx" ON "investigation_quarantine"("report_snapshot_id");

-- AddForeignKey
ALTER TABLE "investigation_quarantine" ADD CONSTRAINT "investigation_quarantine_report_snapshot_id_fkey" FOREIGN KEY ("report_snapshot_id") REFERENCES "investigation_report"("snapshot_id") ON DELETE CASCADE ON UPDATE CASCADE;
