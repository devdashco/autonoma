/*
  Warnings:

  - A unique constraint covering the columns `[organization_id,github_repository_id]` on the table `application` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "application_organization_id_github_repository_id_key" ON "application"("organization_id", "github_repository_id");
