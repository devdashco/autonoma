-- Drop previewkit_config_revision.created_by and .source. Revisions no longer
-- record who saved them or where the document originated; the Application's
-- active revision pointer is the only provenance the deploy pipeline reads.

-- AlterTable
ALTER TABLE "previewkit_config_revision" DROP COLUMN "created_by",
DROP COLUMN "source";

-- DropEnum
DROP TYPE "previewkit_config_source";
