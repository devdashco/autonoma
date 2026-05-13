-- CreateEnum
CREATE TYPE "refinement_iteration_status" AS ENUM ('pending', 'running', 'completed');

-- AlterTable
ALTER TABLE "refinement_iteration" ADD COLUMN     "status" "refinement_iteration_status" NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE "run" ADD COLUMN     "plan_id" TEXT;

-- CreateTable
CREATE TABLE "refinement_iteration_input" (
    "iteration_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refinement_iteration_input_pkey" PRIMARY KEY ("iteration_id","plan_id")
);

-- CreateIndex
CREATE INDEX "refinement_iteration_input_iteration_id_idx" ON "refinement_iteration_input"("iteration_id");

-- CreateIndex
CREATE INDEX "run_plan_id_idx" ON "run"("plan_id");

-- AddForeignKey
ALTER TABLE "refinement_iteration_input" ADD CONSTRAINT "refinement_iteration_input_iteration_id_fkey" FOREIGN KEY ("iteration_id") REFERENCES "refinement_iteration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refinement_iteration_input" ADD CONSTRAINT "refinement_iteration_input_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "test_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "test_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
