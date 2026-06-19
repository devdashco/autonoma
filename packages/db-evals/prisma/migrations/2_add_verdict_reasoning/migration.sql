-- AlterTable
ALTER TABLE "benchmark_generation" ADD COLUMN "verdict_reasoning" TEXT;

-- AlterTable
ALTER TABLE "benchmark_run" ADD COLUMN "verdict_reasoning" TEXT;
