-- AlterTable
ALTER TABLE "run" ADD COLUMN     "failure" JSONB;

-- AlterTable
ALTER TABLE "test_generation" ADD COLUMN     "failure" JSONB;
