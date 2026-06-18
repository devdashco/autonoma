-- CreateTable
CREATE TABLE "generation_metric" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "test_generation_id" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_metric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_metric_batch_id_idx" ON "generation_metric"("batch_id");

-- CreateIndex
CREATE INDEX "generation_metric_test_generation_id_idx" ON "generation_metric"("test_generation_id");

-- AddForeignKey
ALTER TABLE "generation_metric" ADD CONSTRAINT "generation_metric_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "benchmark_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
