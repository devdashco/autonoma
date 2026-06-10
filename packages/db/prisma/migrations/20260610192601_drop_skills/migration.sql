-- DropForeignKey
ALTER TABLE "skill_assignment" DROP CONSTRAINT "skill_assignment_snapshot_id_fkey";

-- DropForeignKey
ALTER TABLE "skill_assignment" DROP CONSTRAINT "skill_assignment_skill_id_fkey";

-- DropForeignKey
ALTER TABLE "skill_assignment" DROP CONSTRAINT "skill_assignment_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "skill" DROP CONSTRAINT "skill_application_id_fkey";

-- DropForeignKey
ALTER TABLE "skill" DROP CONSTRAINT "skill_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "skill_plan" DROP CONSTRAINT "skill_plan_skill_id_fkey";

-- DropForeignKey
ALTER TABLE "skill_plan" DROP CONSTRAINT "skill_plan_organization_id_fkey";

-- DropTable
DROP TABLE "skill_assignment";

-- DropTable
DROP TABLE "skill";

-- DropTable
DROP TABLE "skill_plan";

