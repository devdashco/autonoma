import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseEntityAudit } from "../../src/agents/04-recipe-builder/entity-order";

describe("parseEntityAudit", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "entity-audit-"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    async function write(content: string) {
        await writeFile(join(dir, "entity-audit.md"), content, "utf-8");
    }

    test("parses well-formed YAML frontmatter", async () => {
        await write(`---
model_count: 2
factory_count: 1
models:
  - name: User
    independently_created: true
    creation_file: src/user.ts
    creation_function: UserService.create
    side_effects:
      - hashes password
    created_by: []
  - name: Settings
    independently_created: false
    created_by:
      - owner: User
        via: UserService.create
        why: "Every User gets default Settings."
---

# Entity Audit
`);
        const models = await parseEntityAudit(dir);
        expect(models.map((m) => m.name)).toEqual(["User", "Settings"]);
        const user = models.find((m) => m.name === "User")!;
        expect(user.independently_created).toBe(true);
        expect(user.side_effects).toEqual(["hashes password"]);
        const settings = models.find((m) => m.name === "Settings")!;
        expect(settings.independently_created).toBe(false);
        expect(settings.created_by[0]?.owner).toBe("User");
    });

    test("does not throw when the file has no frontmatter - falls back to a line scan", async () => {
        // This is exactly the shape that used to crash the recipe builder with
        // "entity-audit.md has no YAML frontmatter".
        await write(`# Entity Audit

  - name: User
    independently_created: true
  - name: Order
    independently_created: true
`);
        const models = await parseEntityAudit(dir);
        expect(models.map((m) => m.name)).toEqual(["User", "Order"]);
    });

    test("recovers from malformed YAML via the line-scan fallback", async () => {
        await write(`---
models:
  - name: User
    independently_created: true
    why: "unbalanced quote
  - name: Order
    independently_created: false
---
`);
        const models = await parseEntityAudit(dir);
        expect(models.map((m) => m.name)).toContain("User");
        expect(models.map((m) => m.name)).toContain("Order");
    });

    test("returns an empty list for an empty file rather than throwing", async () => {
        await write("");
        await expect(parseEntityAudit(dir)).resolves.toEqual([]);
    });
});
