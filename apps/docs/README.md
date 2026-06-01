# @autonoma/docs

Public documentation site for Autonoma's agentic end-to-end testing platform. Deployed to `docs.autonoma.app`.

## Tech Stack

- **Astro** - Static site generator (strict TypeScript config)
- **MDX** - Markdown with JSX components for interactive content
- **Tailwind CSS v4** - Styling via `@tailwindcss/vite` plugin
- **Expressive Code** - Syntax-highlighted code blocks (GitHub dark/light themes)
- **React** - Used for interactive components alongside Astro
- **@autonoma/blacklight** - Shared UI component library

## Running Locally

```bash
# From monorepo root
pnpm install
pnpm docs          # starts dev server at localhost:4321

# Or from this directory
pnpm dev            # astro dev
pnpm build          # astro build (outputs to dist/)
pnpm preview        # preview production build
```

## Directory Structure

```
src/
├── content/
│   └── docs/                  # Documentation pages (md/mdx)
│       ├── index.mdx          # Landing page
│       ├── guides/            # Environment factory, etc.
│       ├── examples/          # Framework-specific examples (Next.js, Vite, Phoenix, etc.)
│       └── test-planner/      # Test planner workflow (knowledge base, scenarios, e2e tests)
├── components/                # Astro components (Card, Sidebar, TableOfContents, etc.)
├── layouts/
│   └── DocsLayout.astro       # Main docs layout
├── pages/
│   ├── [...slug].astro        # Dynamic route for all doc pages
│   ├── llms.txt.ts            # LLM-friendly index (llms.txt standard)
│   ├── llms-full.txt.ts       # Full docs concatenated for LLM consumption
│   └── llms/[...slug].txt.ts  # Per-page plain text for LLMs
├── lib/
│   ├── llms/                  # Helpers for generating llms.txt endpoints
│   └── remark-callouts.mjs    # Custom remark plugin for callout directives
├── styles/
│   └── docs.css               # Global styles
└── content.config.ts          # Astro content collection schema (title, description)
```

## Key Architecture Notes

- **Content collections** - Docs are defined as an Astro content collection with a glob loader. Each page requires a `title` in frontmatter; `description` is optional.
- **Custom remark plugins** - `remark-directive` + a custom `remarkCallouts` plugin enable callout syntax in markdown (e.g., `:::note`).
- **LLM-friendly output** - The site generates `llms.txt`, `llms-full.txt`, and per-page `.txt` endpoints following the llms.txt standard, making documentation accessible to language models.

## Adding a New Page

1. Create a `.md` or `.mdx` file under `src/content/docs/` in the appropriate directory.
2. Add frontmatter with at least `title`.
3. The page is automatically available at the corresponding URL slug.
4. Docs deploy automatically on push to `main` when `apps/docs/**` files change.
