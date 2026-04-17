---
title: "Step 4: Generate E2E Tests"
description: "Generate an E2E test suite as markdown files after the knowledge base and scenarios are ready."
---

The E2E test generation step consumes the knowledge base and scenarios produced earlier in the pipeline and turns them into natural-language markdown test cases.

## Prerequisites

- `autonoma/AUTONOMA.md` and `autonoma/skills/` from [Step 2](/test-planner/step-1-knowledge-base/)
- `autonoma/scenarios.md` from [Step 3](/test-planner/step-2-scenarios/)

## What this produces

- `autonoma/qa-tests/INDEX.md`
- `autonoma/qa-tests/**/*`

The generated suite is organized by flow and priority. Core flows should receive the deepest coverage, while supporting areas still get enough tests to catch regressions.

## What to review

You do not need to read every generated test. Review a representative sample:

- journey tests that cross multiple important flows
- critical tests for the product’s highest-value behaviors
- tests that reference scenario data with variable placeholders

Good tests reference actual UI text and visible outcomes. Vague steps or generic assertions usually mean the suite needs another pass.
