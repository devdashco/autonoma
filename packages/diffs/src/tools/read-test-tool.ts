import { tool } from "ai";
import { z } from "zod";
import type { ExistingTestInfo, QuarantineInfo } from "../diffs-agent";

const readTestsSchema = z.object({
    slugs: z
        .array(z.string())
        .min(1)
        .describe(
            "List of test slugs to read. Pass every slug you need in a single call rather than calling this tool one slug at a time.",
        ),
});

type TestSuccess = {
    name: string;
    instruction: string;
    quarantine?: QuarantineInfo;
};

type TestResult = TestSuccess | { error: string };

export function buildReadTestTool(tests: ExistingTestInfo[]) {
    const testsBySlug = new Map(tests.map((t) => [t.slug, t]));

    return tool({
        description:
            "Read the full instructions (prompts) of one or more tests by slug in a single call. " +
            "Pass every slug you need in the `slugs` array - do not call this tool repeatedly for individual slugs. " +
            "Returns a `results` object keyed by slug.",
        inputSchema: readTestsSchema,
        execute: async ({ slugs }) => {
            const results: Record<string, TestResult> = {};
            for (const slug of slugs) {
                const test = testsBySlug.get(slug);
                if (test == null) {
                    results[slug] = { error: `Test "${slug}" not found.` };
                    continue;
                }
                results[slug] = { name: test.name, instruction: test.prompt, quarantine: test.quarantine };
            }
            return { results };
        },
    });
}
