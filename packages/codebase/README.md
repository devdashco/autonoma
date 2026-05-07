# @autonoma/codebase

A small package that gives reviewers (and other AI agents) read access to the user's source tree at a specific commit, plus an AI SDK `ToolSet` for `read_file` / `grep` / `list_directory`.

## Why

Reviewers can do better grounded reasoning when they can verify that an element a test plan references actually exists in the application's source code, or distinguish a stale test definition (`engine_error`) from a true app bug.

## What's here

A single class - `Codebase` - that wraps a directory on disk and offers a small read API (`readFile`, `grep`, `listDirectory`, `dispose`). Use the static factory `Codebase.clone(...)` to populate the directory from a GitHub commit, or construct one directly (`new Codebase(path)`) when you already have a populated tree (tests).

The clone factory throws on any failure (missing repo, GitHub API error, clone error) and removes the partially-populated `targetDir` before rethrowing. Lifecycle is the caller's: call `dispose()` explicitly when done.

## Navigation is unrestricted

The reviewer agent is trusted internal code reading the user's own repo - there's no adversarial relationship. Paths passed to `readFile` / `listDirectory` are resolved relative to `Codebase.root` for convenience, but `..` traversal, absolute paths, and symlinks pointing outside the clone are all allowed. If the agent asks for `/etc/passwd`, it'll get whatever `fs.readFile` returns. If the user's repo has a symlink pointing to `node_modules/somewhere/whatever.ts`, the agent can follow it.

This is a deliberate choice: sandboxing the read API would create real friction (monorepo symlinks, package-linked dev setups) without protecting against a real threat.

## Exports

| Export | Description |
|--------|-------------|
| `Codebase` | Class wrapping a directory; read API + `dispose` + `static clone(...)`. |
| `buildCodebaseTools(codebase)` | AI SDK `ToolSet`: `read_file`, `grep`, `list_directory`. |
| `ReadFileOptions`, `GrepOptions`, `GrepHit`, `DirectoryEntry` | Types. |

## Usage

```ts
import { Codebase } from "@autonoma/codebase";

const githubClient = await githubApp.getInstallationClient(installationId);
const codebase = await Codebase.clone(githubClient, "/tmp/codebase/my-seed", {
    repoName: "owner/repo",
    commitSha: "abc123...",
});

try {
    const hits = await codebase.grep("Sign In", { glob: "src/**/*.tsx" });
    const file = await codebase.readFile("src/components/Login.tsx", { startLine: 10, endLine: 40 });
} finally {
    await codebase.dispose();
}
```

### Plugging into a reviewer

```ts
import { buildCodebaseTools } from "@autonoma/codebase";

const tools = {
    ...buildScreenshotTools(...),
    ...buildCodebaseTools(codebase),
    submit_verdict: buildVerdictTool(verdictSchema),
};
```

## Tests

Real local git fixtures (no GitHub round-trips). Tests construct `Codebase` directly with `new Codebase(path)` since the read API has nothing to do with cloning. One test creates a symlink in the fixture pointing outside the directory and asserts `readFile` happily follows it - confirming the unrestricted-navigation contract.

## Dependencies

- `@autonoma/github` - `GitHubInstallationClient`, `cloneRepository` (used by `Codebase.clone`)
- `@autonoma/logger` - structured logging
- `ai` (Vercel AI SDK) - tool factory
- `zod` - tool input schemas
