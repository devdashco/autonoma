-- DropForeignKey
ALTER TABLE "step_output" DROP CONSTRAINT "step_output_step_input_id_fkey";

-- AddForeignKey
ALTER TABLE "step_output" ADD CONSTRAINT "step_output_step_input_id_fkey" FOREIGN KEY ("step_input_id") REFERENCES "step_input"("id") ON DELETE CASCADE ON UPDATE CASCADE;
