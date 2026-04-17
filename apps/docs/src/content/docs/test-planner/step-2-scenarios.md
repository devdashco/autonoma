---
title: "Step 3: Generate Scenarios"
description: "Design the standard, empty, and large test data environments from the knowledge base and the SDK discover artifact."
---

The scenario generator runs **after SDK Integration and Knowledge Base generation**. It does not expect you to provide the SDK endpoint URL or shared request-signing secret manually anymore. Instead, it consumes the verified endpoint and `discover` artifact produced earlier in the pipeline.

## Prerequisites

- `autonoma/AUTONOMA.md` and `autonoma/skills/` from [Step 2](/test-planner/step-1-knowledge-base/)
- a verified SDK integration from Step 1
- `autonoma/discover.json` captured from that integration

If the SDK endpoint is unavailable, this step stops and the pipeline needs the Step 1 integration/dev server issue fixed first.

## What this produces

- `autonoma/discover.json`
- `autonoma/scenarios.md`

The scenarios file describes three named environments:

- `standard` for realistic day-to-day coverage
- `empty` for onboarding and zero-state flows
- `large` for pagination and high-volume behavior

## What to review

Scenarios are a contract between planning and execution. Review:

- whether the important entities and relationships are represented
- whether fixed names and counts are realistic enough for meaningful assertions
- whether variable fields are marked only where runtime variation is actually required
- whether the three scenarios cover your core flows without over-segmenting the data model

Later stages use these values directly. Wrong names, missing relationships, or unnecessary variable fields will make the generated tests and validation results worse.
