-- Destructive and irreversible: drops the revision-history model. Safe only once
-- `20260709000000_previewkit_config_add` is deployed and the backfill has copied
-- every Application's active revision into `previewkit_config` in every
-- environment; running it before then loses config that was never copied.

-- DropForeignKey
ALTER TABLE "application" DROP CONSTRAINT "application_active_config_revision_id_fkey";

-- DropForeignKey
ALTER TABLE "previewkit_config_revision" DROP CONSTRAINT "previewkit_config_revision_application_id_fkey";

-- DropIndex
DROP INDEX "application_active_config_revision_id_key";

-- AlterTable
ALTER TABLE "application" DROP COLUMN "active_config_revision_id";

-- AlterTable
ALTER TABLE "previewkit_environment" DROP COLUMN "config_revision_id";

-- DropTable
DROP TABLE "previewkit_config_revision";
