-- Model GitHub `push` webhook deliveries: a push to the branch a main-branch
-- preview environment tracks redeploys environment 0 at the new head. Only
-- pushes that update such an environment are recorded.
ALTER TYPE "github_webhook_event_type" ADD VALUE IF NOT EXISTS 'push';
