-- CreateEnum
CREATE TYPE "github_webhook_event_type" AS ENUM ('installation_created', 'installation_deleted', 'installation_suspend', 'installation_unsuspend', 'installation_repositories_added', 'installation_repositories_removed', 'pull_request_opened', 'pull_request_synchronize', 'pull_request_closed', 'pull_request_reopened');

-- CreateTable
CREATE TABLE "github_webhook_event" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "type" "github_webhook_event_type" NOT NULL,
    "action" TEXT,
    "installation_id" INTEGER,
    "organization_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_webhook_event_delivery_id_key" ON "github_webhook_event"("delivery_id");

-- CreateIndex
CREATE INDEX "github_webhook_event_organization_id_type_received_at_idx" ON "github_webhook_event"("organization_id", "type", "received_at");

-- CreateIndex
CREATE INDEX "github_webhook_event_installation_id_received_at_idx" ON "github_webhook_event"("installation_id", "received_at");

-- AddForeignKey
ALTER TABLE "github_webhook_event" ADD CONSTRAINT "github_webhook_event_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
