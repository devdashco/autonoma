# `@autonoma-ai/planner` (apps/cli)

The Autonoma test planner CLI - generates E2E test cases for any frontend codebase. Published to npm as `@autonoma-ai/planner` (bin: `autonoma-planner`), versioned independently from the rest of the monorepo via release-please (`cli-v*` tags).

## CRITICAL: Agent Architecture Principles

These are the most important rules in this codebase. Violating them causes cascading failures.

### 1. NO framework/language coupling in agent prompts or code

This tool analyzes ANY frontend codebase - React, Vue, Angular, Django, Rails, Svelte, or anything else. Agent prompts and supporting code MUST NEVER:

- Hardcode file extensions (`.tsx`, `.jsx`, `.vue`, `.svelte`)
- Hardcode directory patterns (`app/`, `pages/`, `_components/`, `src/app`)
- Hardcode framework patterns (`page.tsx`, `+page.svelte`, `layout.tsx`)
- Reference specific frameworks by name as instructions (e.g., "For Next.js, do X")
- Count files of a specific type as a proxy for complexity (e.g., counting `.tsx` files)
- Assume any routing convention, component naming convention, or directory structure

**Why:** The agents have tools (read_file, glob, grep, bash). They can discover the framework and patterns themselves. Hardcoding assumptions breaks on every project that doesn't match. The page finder agent already proves this works - it discovers pages without hardcoded patterns.

**Instead:** Tell agents WHAT to find (pages, models, components), not HOW to find them. Let them explore the codebase and discover the patterns. They are agents, not query engines.

### 2. NO project-specific content in prompts

Agent prompts MUST NEVER contain:
- Specific app names, route names, or feature names as examples
- Real code snippets from any specific project
- References to specific frameworks as "the default" or "most common"

**Why:** Project-specific examples bias the agent toward one pattern and cause hallucination on different projects.

**Instead:** Use abstract examples that work for any project. If you need examples, describe the CONCEPT, not a specific implementation.

### 3. Complexity comes from reading source, not counting files

Never use file counts, directory sizes, or glob results as a proxy for feature complexity. The agent reads the actual source code and judges complexity by what it finds - number of interactive elements, forms, workflows, conditional logic, etc.

**Why:** File organization varies wildly between projects. A monorepo might put 300 components in a shared `_components/` folder while the page files are empty wrappers. Counting files in the page directory would say "simple" when the feature is massive.

---

## Tooling

This package follows the monorepo conventions (see the root `CLAUDE.md`): ESM-only, strictest TypeScript, pnpm + turborepo, `undefined` over `null`, `??`/`!= null`, no `.js` import extensions.

- **Package manager:** pnpm (shared root lockfile). Do NOT use bun for install/run - bun is only used by the dev-only `eval:classifier` script if at all.
- **Build:** `tsup` -> `dist/index.js` (the published bin). Run `pnpm --filter @autonoma-ai/planner build`.
- **Dev:** `pnpm --filter @autonoma-ai/planner dev` (`tsx src/index.ts`).
- **Typecheck:** `tsc --noEmit`. **Lint:** `oxlint`. **Test:** `vitest run`.
- Shared dependency versions (`ai`, `zod`, `typescript`, `tsx`, `vitest`, `@types/node`) come from the workspace `catalog:` in `pnpm-workspace.yaml`. CLI-only deps (`@clack/*`, `@openrouter/ai-sdk-provider`, `glob`, etc.) are pinned locally.

## Release

Independent of the monorepo's k8s release. release-please tracks this package as the `cli` component (`cli-v*` tags). On a published `cli-v*` GitHub release, `.github/workflows/cli-publish.yml` publishes to npm. The k8s production deploy (`production-build.yml`) only fires on root `v*` tags and explicitly skips `cli-v*`.
