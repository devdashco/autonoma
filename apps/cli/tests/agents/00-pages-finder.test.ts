import { describe, test } from "vitest";
import { runPageFinder } from "../../src/agents/00-pages-finder";

describe("PageFinderAgent", () => {
    test.skip("find the pages on a project", { timeout: 600_000 }, async () => {
        const result = await runPageFinder({
            projectRoot: "project path",
            nonInteractive: true,
            outputDir: "output path",
            extraMessage: "Skip the /docs. Only do the react app.",
        });

        console.log("result", result);
    });
});
