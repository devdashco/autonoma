-- Triage Agent + Refinement Loop schema migration.
--
-- Reshapes Bug to be per-application with many-to-many test case evidence,
-- adds engine_limitation discriminator + snapshot scope to Issue, and
-- introduces TestCaseQuarantine and the RefinementLoop audit-trail tables.

-- ─── New enums ───────────────────────────────────────────────────────────────

CREATE TYPE "issue_kind" AS ENUM ('application_bug', 'engine_limitation');

CREATE TYPE "quarantine_reason" AS ENUM ('application_bug', 'engine_limitation');

CREATE TYPE "refinement_trigger" AS ENUM ('onboarding', 'diffs');

CREATE TYPE "refinement_status" AS ENUM ('running', 'converged', 'max_iterations', 'error');

CREATE TYPE "refinement_action_kind" AS ENUM ('update_plan', 'add_test', 'report_bug', 'report_engine_limitation', 'remove_test');

-- ─── Issue: replace `category` with `kind`, add snapshot scope ──────────────

ALTER TABLE "issue"
    ADD COLUMN "kind" "issue_kind" NOT NULL DEFAULT 'application_bug',
    ADD COLUMN "snapshot_id" TEXT;

ALTER TABLE "issue"
    ADD CONSTRAINT "issue_snapshot_id_fkey" FOREIGN KEY ("snapshot_id")
    REFERENCES "branch_snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "issue_snapshot_id_idx" ON "issue"("snapshot_id");

-- Drop legacy `category` column and its enum. Pre-launch schema, no
-- production data preservation needed for the agent_error category.
ALTER TABLE "issue" DROP COLUMN "category";

DROP TYPE "issue_category";

-- Drop `confidence` column. Under the agent-driven model the field has no
-- meaning - the agent commits to creating an Issue or doesn't, there is no
-- per-row probabilistic interpretation.
ALTER TABLE "issue" DROP COLUMN "confidence";

-- ─── Bug: per-application + many-to-many evidence ───────────────────────────

-- Add new application FK.
ALTER TABLE "bug" ADD COLUMN "application_id" TEXT;

-- Backfill: bug.branch_id → branch.application_id.
UPDATE "bug" b
SET "application_id" = br."application_id"
FROM "branch" br
WHERE br."id" = b."branch_id";

-- Bugs without a backfilled application get dropped (cascade will remove
-- their issues' bugId via SetNull). This shouldn't happen in pre-launch but
-- prevents a non-null constraint failure if it does.
DELETE FROM "bug" WHERE "application_id" IS NULL;

ALTER TABLE "bug" ALTER COLUMN "application_id" SET NOT NULL;

ALTER TABLE "bug"
    ADD CONSTRAINT "bug_application_id_fkey" FOREIGN KEY ("application_id")
    REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "bug_application_id_idx" ON "bug"("application_id");

-- New evidence join table.
CREATE TABLE "bug_test_case_evidence" (
    "id" TEXT NOT NULL,
    "bug_id" TEXT NOT NULL,
    "test_case_id" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bug_test_case_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bug_test_case_evidence_bug_id_test_case_id_key"
    ON "bug_test_case_evidence"("bug_id", "test_case_id");

CREATE INDEX "bug_test_case_evidence_test_case_id_idx"
    ON "bug_test_case_evidence"("test_case_id");

ALTER TABLE "bug_test_case_evidence"
    ADD CONSTRAINT "bug_test_case_evidence_bug_id_fkey" FOREIGN KEY ("bug_id")
    REFERENCES "bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bug_test_case_evidence"
    ADD CONSTRAINT "bug_test_case_evidence_test_case_id_fkey" FOREIGN KEY ("test_case_id")
    REFERENCES "test_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill evidence rows from existing Bug.test_case_id (1:1 mapping).
INSERT INTO "bug_test_case_evidence" ("id", "bug_id", "test_case_id", "first_seen_at", "last_seen_at")
SELECT
    'btce_' || b."id",
    b."id",
    b."test_case_id",
    b."first_seen_at",
    b."last_seen_at"
FROM "bug" b;

-- Drop legacy Bug columns and the old composite index.
DROP INDEX "bug_branch_id_test_case_id_idx";

ALTER TABLE "bug"
    DROP CONSTRAINT "bug_branch_id_fkey",
    DROP CONSTRAINT "bug_test_case_id_fkey",
    DROP COLUMN "branch_id",
    DROP COLUMN "test_case_id";

-- ─── TestCaseQuarantine ─────────────────────────────────────────────────────

CREATE TABLE "test_case_quarantine" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "test_case_id" TEXT NOT NULL,
    "reason" "quarantine_reason" NOT NULL,
    "bug_id" TEXT,
    "issue_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" TEXT NOT NULL,
    CONSTRAINT "test_case_quarantine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "test_case_quarantine_snapshot_id_test_case_id_key"
    ON "test_case_quarantine"("snapshot_id", "test_case_id");

CREATE INDEX "test_case_quarantine_test_case_id_idx"
    ON "test_case_quarantine"("test_case_id");

ALTER TABLE "test_case_quarantine"
    ADD CONSTRAINT "test_case_quarantine_snapshot_id_fkey" FOREIGN KEY ("snapshot_id")
    REFERENCES "branch_snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "test_case_quarantine_test_case_id_fkey" FOREIGN KEY ("test_case_id")
    REFERENCES "test_case"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "test_case_quarantine_bug_id_fkey" FOREIGN KEY ("bug_id")
    REFERENCES "bug"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "test_case_quarantine_issue_id_fkey" FOREIGN KEY ("issue_id")
    REFERENCES "issue"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "test_case_quarantine_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Refinement audit trail ─────────────────────────────────────────────────

CREATE TABLE "refinement_loop" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "triggered_by" "refinement_trigger" NOT NULL,
    "status" "refinement_status" NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "organization_id" TEXT NOT NULL,
    CONSTRAINT "refinement_loop_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refinement_loop_snapshot_id_idx" ON "refinement_loop"("snapshot_id");

ALTER TABLE "refinement_loop"
    ADD CONSTRAINT "refinement_loop_snapshot_id_fkey" FOREIGN KEY ("snapshot_id")
    REFERENCES "branch_snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "refinement_loop_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "refinement_iteration" (
    "id" TEXT NOT NULL,
    "loop_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "refinement_iteration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refinement_iteration_loop_id_number_key"
    ON "refinement_iteration"("loop_id", "number");

ALTER TABLE "refinement_iteration"
    ADD CONSTRAINT "refinement_iteration_loop_id_fkey" FOREIGN KEY ("loop_id")
    REFERENCES "refinement_loop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "refinement_action" (
    "id" TEXT NOT NULL,
    "iteration_id" TEXT NOT NULL,
    "plan_id" TEXT,
    "test_case_id" TEXT,
    "kind" "refinement_action_kind" NOT NULL,
    "payload" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refinement_action_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refinement_action_iteration_id_idx" ON "refinement_action"("iteration_id");

ALTER TABLE "refinement_action"
    ADD CONSTRAINT "refinement_action_iteration_id_fkey" FOREIGN KEY ("iteration_id")
    REFERENCES "refinement_iteration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
