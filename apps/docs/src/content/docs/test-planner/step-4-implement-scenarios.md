---
title: "Step 5: Scenario Validation"
description: "Validate the planned scenarios against the live SDK endpoint and persist executable recipe artifacts."
---

The final plugin stage is now **Scenario Validation**, not SDK implementation. By the time this step runs, the plugin has already integrated the SDK in Step 1 and verified that a live endpoint exists.

This step takes the planned scenarios and checks that they work against the live endpoint by exercising the current SDK contract.

## Prerequisites

- `autonoma/discover.json`
- `autonoma/scenarios.md`
- a live SDK endpoint produced by Step 1

If the endpoint is unreachable at this stage, the pipeline should fail with guidance to fix the SDK integration or dev server rather than attempting to re-implement the SDK.

## What this produces

- `autonoma/scenario-recipes.json`

The generated recipe file is the validated handoff between planning and execution. It is what later Autonoma flows use to create and tear down scenario data reliably.

## What this validates

- `discover` still works against the live endpoint
- `up` can create the planned scenario data
- `down` can clean it up again
- the scenario recipes conform to the current SDK contract

## What to review

Review the validation summary for:

- any scenario that fails lifecycle validation
- schema or relationship mismatches between the plan and the live endpoint
- missing recipe coverage for `standard`, `empty`, or `large`

This stage should validate and upload recipes only. It should not be the point where the plugin starts rewriting your SDK integration.
