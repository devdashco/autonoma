-- Split the review verdict enums:
-- 1. Rename `generation_review_status` -> `review_status` (now shared with run_review).
-- 2. Replace `generation_review_verdict` (agent_error | application_bug) with the
--    4-outcome set (success | agent_limitation | application_bug | plan_mismatch).
--    Existing `agent_error` rows become `agent_limitation`.
-- 3. Introduce `run_review_verdict` (engine_error | application_bug) as a new enum.
--    `run_review.verdict` switches off the generation enum onto it.
--    Existing `agent_error` rows become `engine_error`.

-- 1. Rename shared status enum.
ALTER TYPE "generation_review_status" RENAME TO "review_status";

-- 2. Generation verdict: replace enum.
CREATE TYPE "generation_review_verdict_new" AS ENUM ('success', 'agent_limitation', 'application_bug', 'plan_mismatch');

ALTER TABLE "generation_review"
    ALTER COLUMN "verdict" TYPE "generation_review_verdict_new"
    USING (
        CASE "verdict"::text
            WHEN 'agent_error' THEN 'agent_limitation'
            WHEN 'application_bug' THEN 'application_bug'
        END
    )::"generation_review_verdict_new";

-- 3. Run verdict: switch column off the generation enum onto a fresh enum.
CREATE TYPE "run_review_verdict" AS ENUM ('engine_error', 'application_bug');

ALTER TABLE "run_review"
    ALTER COLUMN "verdict" TYPE "run_review_verdict"
    USING (
        CASE "verdict"::text
            WHEN 'agent_error' THEN 'engine_error'
            WHEN 'application_bug' THEN 'application_bug'
        END
    )::"run_review_verdict";

-- Drop the old generation enum and promote the new one to its name.
DROP TYPE "generation_review_verdict";
ALTER TYPE "generation_review_verdict_new" RENAME TO "generation_review_verdict";
