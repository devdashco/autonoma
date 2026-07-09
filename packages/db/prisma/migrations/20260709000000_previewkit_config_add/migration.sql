-- Expand phase of the latest-only preview-config cutover. Adds the new
-- previewkit_config table (one row per Application) WITHOUT touching the legacy
-- revision model. The data backfill runs as a separate, dry-runnable script
-- (apps/api/src/scripts/backfill-previewkit-config.ts) so the copy is decoupled
-- from any destructive change and can be verified per environment; a later
-- contract migration drops previewkit_config_revision,
-- application.active_config_revision_id, and
-- previewkit_environment.config_revision_id once every environment is backfilled.

-- CreateTable
CREATE TABLE "previewkit_config" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "dependency_documents" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "previewkit_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "previewkit_config_application_id_key" ON "previewkit_config"("application_id");

-- AddForeignKey
ALTER TABLE "previewkit_config" ADD CONSTRAINT "previewkit_config_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
