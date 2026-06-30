import { describe, expect, test, vi } from "vitest";
import { launchEditor } from "../../src/core/review";

describe("launchEditor", () => {
    // Regression for the Windows crash: `which` listed an editor (e.g. VS Code's
    // `code.cmd` shim) but the spawn failed with an async ENOENT. With no `error`
    // handler the unhandled 'error' event crashed the whole process. A failed
    // launch must now resolve gracefully instead of throwing/crashing.
    test("resolves instead of crashing when the editor can't be spawned", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        const bogusEditor = {
            command: "definitely-not-a-real-editor-xyz",
            label: "Bogus",
            args: (files: string[]) => files,
        };

        await expect(launchEditor(bogusEditor, ["/tmp/autonoma-review-test.md"])).resolves.toBeUndefined();

        warn.mockRestore();
        log.mockRestore();
    });
});
