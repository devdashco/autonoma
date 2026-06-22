-- Drop the previewkit_environment.manifest column. The summary + readiness
-- views now project the manifest shape (app/service/addon names, ports, etc.)
-- from resolved_config at read time, so the denormalized manifest snapshot is
-- redundant.

-- AlterTable
ALTER TABLE "previewkit_environment" DROP COLUMN "manifest";
