---
title: "Step 1: SDK Integration"
description: "Detect the project stack, integrate the Autonoma SDK, start a dev server, and verify the endpoint before planning begins."
---

The first stage of the Test Planner is now **SDK Integration**. Instead of asking you to pre-configure the SDK endpoint URL and shared request-signing secret, the plugin handles the integration itself.

## What this step does

- detects the project stack
- installs the SDK from the appropriate package manager
- wires the SDK endpoint into the application
- ensures the required local secrets exist
- starts or reuses a dev server
- verifies `discover`, `up`, and `down`
- writes `autonoma/.sdk-endpoint` for later stages
- writes `autonoma/.sdk-integration.json` so the orchestrator can prove Step 1 completed cleanly

## Prerequisites

- your repository is open in Claude Code
- the Claude session has:
  - `AUTONOMA_API_KEY`
  - `AUTONOMA_PROJECT_ID`
  - `AUTONOMA_API_URL`

## Supported and unsupported stacks

If the plugin finds a supported stack, it continues automatically into the rest of the pipeline.

If the stack is unsupported, the pipeline stops here and gives you a contact path to Autonoma instead of trying to guess the integration.

## What to review

The canonical launch mode is `AUTONOMA_AUTO_ADVANCE=true`, which continues directly to Step 2 after validation. If you are still using the older confirmation flag, `AUTONOMA_REQUIRE_CONFIRMATION=false` is treated as the same auto-advance behavior.

If the plugin surfaces a review checkpoint here, focus on:

- whether it detected the right framework and ORM
- whether the endpoint path looks correct for your project
- whether the dev server and smoke tests succeeded
- whether the repo changes are isolated to SDK integration work
