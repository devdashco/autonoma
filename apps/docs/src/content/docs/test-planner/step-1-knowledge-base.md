---
title: "Step 2: Generate Knowledge Base"
description: "Analyze your codebase to produce AUTONOMA.md after the SDK Integration step has finished."
---

The knowledge base generator runs **after SDK Integration**. By the time this step starts, the plugin has already verified a working SDK endpoint and can use that fact later when it plans scenarios.

This step analyzes your codebase and produces a user-perspective guide to every important page, flow, and interaction in your application. It also writes navigation skill files that later steps can reuse.

## Prerequisites

- Step 1 SDK Integration must have completed successfully.
- Your application codebase must be available in the workspace.

## What this produces

- `autonoma/AUTONOMA.md`
- `autonoma/skills/*.md`
- `autonoma/features.json`

## What to review

The most important output is the **core flows** table. Core flows are the workflows that receive the heaviest test coverage later in the pipeline.

When reviewing:

- check that the product areas are named the way your team names them
- confirm the true core flows are marked as core
- make sure obvious high-value flows were not missed

If the core flows are wrong, the rest of the suite will be prioritized incorrectly.
