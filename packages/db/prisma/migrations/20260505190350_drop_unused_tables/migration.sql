/*
  Warnings:

  - You are about to drop the column `mode` on the `application` table. All the data in the column will be lost.
  - You are about to drop the column `webhook_url` on the `application` table. All the data in the column will be lost.
  - You are about to drop the column `redeemed_at` on the `billing_promo_redemption` table. All the data in the column will be lost.
  - You are about to drop the column `github_ref` on the `branch` table. All the data in the column will be lost.
  - You are about to drop the column `pr_number` on the `branch` table. All the data in the column will be lost.
  - You are about to drop the column `deployment_id` on the `branch_snapshot` table. All the data in the column will be lost.
  - You are about to drop the column `discovery_attempts` on the `onboarding_state` table. All the data in the column will be lost.
  - You are about to drop the column `production_tests_passed` on the `onboarding_state` table. All the data in the column will be lost.
  - You are about to drop the `application_setup_artifact` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `github_deployment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `github_repository` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `github_repository_file` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `folder_id` on table `test_case` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "application_setup_artifact" DROP CONSTRAINT "application_setup_artifact_application_id_fkey";

-- DropForeignKey
ALTER TABLE "application_setup_artifact" DROP CONSTRAINT "application_setup_artifact_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "application_setup_artifact" DROP CONSTRAINT "application_setup_artifact_setup_id_fkey";

-- DropForeignKey
ALTER TABLE "branch_snapshot" DROP CONSTRAINT "branch_snapshot_deployment_id_fkey";

-- DropForeignKey
ALTER TABLE "github_deployment" DROP CONSTRAINT "github_deployment_repository_id_fkey";

-- DropForeignKey
ALTER TABLE "github_repository" DROP CONSTRAINT "github_repository_application_id_fkey";

-- DropForeignKey
ALTER TABLE "github_repository" DROP CONSTRAINT "github_repository_installation_id_fkey";

-- DropForeignKey
ALTER TABLE "github_repository_file" DROP CONSTRAINT "github_repository_file_repository_id_fkey";

-- DropForeignKey
ALTER TABLE "test_case" DROP CONSTRAINT "test_case_folder_id_fkey";

-- AlterTable
ALTER TABLE "application" DROP COLUMN "mode",
DROP COLUMN "webhook_url";

-- AlterTable
ALTER TABLE "billing_promo_redemption" DROP COLUMN "redeemed_at";

-- AlterTable
ALTER TABLE "branch" DROP COLUMN "github_ref",
DROP COLUMN "pr_number";

-- AlterTable
ALTER TABLE "branch_snapshot" DROP COLUMN "deployment_id";

-- AlterTable
ALTER TABLE "onboarding_state" DROP COLUMN "discovery_attempts",
DROP COLUMN "production_tests_passed";

-- AlterTable
ALTER TABLE "test_case" ALTER COLUMN "folder_id" SET NOT NULL;

-- DropTable
DROP TABLE "application_setup_artifact";

-- DropTable
DROP TABLE "github_deployment";

-- DropTable
DROP TABLE "github_repository";

-- DropTable
DROP TABLE "github_repository_file";

-- DropEnum
DROP TYPE "application_mode";

-- DropEnum
DROP TYPE "conversation_message_role";

-- DropEnum
DROP TYPE "github_deployment_status";

-- DropEnum
DROP TYPE "github_deployment_trigger";

-- DropEnum
DROP TYPE "github_generation_status";

-- DropEnum
DROP TYPE "github_indexing_status";

-- AddForeignKey
ALTER TABLE "test_case" ADD CONSTRAINT "test_case_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
