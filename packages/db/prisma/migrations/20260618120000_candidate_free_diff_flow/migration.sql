-- Cut over the diff flow to candidate-free authoring (#1026).
-- The diffs agent now authors tests directly; healing only heals and culls.
-- The TestCandidate machinery and the unused resolution conversation URL are dropped.

-- DropTable (drops its own foreign keys, the accepted_test_case_id unique index, and the status column)
DROP TABLE "test_candidate";

-- DropEnum
DROP TYPE "test_candidate_status";

-- AlterTable
ALTER TABLE "diffs_job" DROP COLUMN "resolution_conversation_url";
