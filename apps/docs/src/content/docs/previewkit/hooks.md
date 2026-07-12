---
title: Lifecycle hooks
description: Commands that run around each deploy of the whole preview - pre-deploy before your apps start, post-deploy once they're ready.
---

<p class="lead">Lifecycle hooks are commands Previewkit runs around each deploy of the whole preview: before your apps start, and after they're ready. Most projects never need them.</p>

![A preview deploy runs the pre-deploy hooks as one-off jobs, then the apps start, then the post-deploy hooks run as one-off jobs](/img/previewkit/hooks-timeline.jpg)

Think of a hook as a step that belongs to the preview itself, not to any single app or database. When a preview deploys, Previewkit runs your pre-deploy hooks, brings the apps up, then runs your post-deploy hooks. Both groups are optional, and you add as many commands to each as you like.

## Pre-deploy and post-deploy

Hooks live in two groups, chosen by when you need them to run:

| Group | When it runs | Good for |
| --- | --- | --- |
| **Pre-deploy** | Before your apps start. | Cache warmup, feature-flag sync. |
| **Post-deploy** | After your apps are ready. | A smoke test, notifying Slack. |

A pre-deploy hook runs while the preview is still coming up, so use it for anything the apps expect to already be in place. A post-deploy hook runs once every app has passed its health check, so use it for anything that needs a live, reachable preview - a quick smoke test against the frontend, or a message to your team that the preview is ready.

```bash
# post-deploy: smoke-test the frontend once it's live
curl --fail "$AUTONOMA_PREVIEWKIT_URL/health"
```

## Where migrations and seeding belong

The one thing lifecycle hooks are **not** for is database setup. It's tempting to reach for a pre-deploy hook to run a migration or seed a table, but that work lives on each database instead.

:::note
Migrations and DB seeding live on each database's setup, not here. Use hooks for whole-preview steps that aren't tied to one database.
:::

Keeping database work on the database means each database owns its own schema and seed data, and Previewkit can run that setup at the right moment for that database rather than as one preview-wide step. See [databases](/previewkit/databases/) for where to put migration and seed commands. Reserve lifecycle hooks for steps that span the whole preview and aren't tied to any single database.

## Optional by design

Hooks sit off the main onboarding flow - you reach them through the optional tab, or the "finish here" fork on the Variables step. Skip them entirely if your preview doesn't need work around its deploys, and come back to add one whenever you do.
