import { generateText, stepCountIs, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openModelSession } from "../src/ai/model-session";
import { createToolBudget } from "../src/tool-output";

/**
 * A real-model evalset (gpt-5.5) for the oversized-tool-output guard. It feeds the agent a file far too large to
 * return whole and checks that, instead of blowing the context window (the prod failure), the per-run budget
 * nudges the model to re-issue a narrower call - and the model still finds the answer. Hits the live OpenAI
 * API, so it only runs with RUN_EVALS=1 (skipped in CI and in plain `pnpm test`). Run it with:
 *   RUN_EVALS=1 pnpm --filter @autonoma/investigation exec vitest run test/context-limit.eval.test.ts
 */
const RUN = process.env.RUN_EVALS === "1" && process.env.OPENAI_API_KEY != null && process.env.OPENAI_API_KEY !== "";

// ~600k chars: reading it whole would be ~150k tokens and, accumulated over a few reads, blow past the limit.
const LINES = Array.from({ length: 12_000 }, (_, i) => `${i + 1}: const filler_${i} = "${"x".repeat(40)}";`);
LINES[8423] = "8424: export const CONFIG_TIMEOUT_MS = 4242; // the value under test";
const FILE = LINES.join("\n");

describe.skipIf(!RUN)("eval: agent handles an oversized tool result (gpt-5.5)", () => {
    it("is nudged on a full-file read, re-issues a narrower call, and still finds the needle", async () => {
        const session = openModelSession({ openaiApiKey: process.env.OPENAI_API_KEY ?? "" });
        const model = session.getModel({ model: "classifier", tag: "eval-context-limit" });
        const cap = createToolBudget();
        const calls: string[] = [];

        const tools = {
            read_file: tool({
                description:
                    "Read big-config.ts. Pass fromLine/toLine (1-indexed, inclusive) to read only a slice; omit them to read the whole file.",
                inputSchema: z.object({ fromLine: z.number().optional(), toLine: z.number().optional() }),
                execute: async ({ fromLine, toLine }) => {
                    calls.push(`read_file(${fromLine ?? "-"},${toLine ?? "-"})`);
                    const slice =
                        fromLine != null && toLine != null ? LINES.slice(fromLine - 1, toLine).join("\n") : FILE;
                    return cap(slice, {
                        tool: "read_file",
                        mode: "narrow",
                        maxChars: 150_000,
                        hint: "pass fromLine/toLine for the section you need.",
                    });
                },
            }),
            grep_file: tool({
                description: "grep big-config.ts for a substring; returns the matching `N: ...` lines.",
                inputSchema: z.object({ pattern: z.string() }),
                execute: async ({ pattern }) => {
                    calls.push(`grep_file(${pattern})`);
                    const matches = LINES.filter((line) => line.includes(pattern))
                        .slice(0, 80)
                        .join("\n");
                    return cap(matches || "(no matches)", {
                        tool: "grep_file",
                        mode: "narrow",
                        maxChars: 24_000,
                        hint: "a more specific pattern.",
                    });
                },
            }),
        };

        const { text } = await generateText({
            model,
            tools,
            stopWhen: stepCountIs(12),
            prompt:
                "Open big-config.ts and find the constant CONFIG_TIMEOUT_MS. Reply with ONLY its numeric value. " +
                "The file is large, so read efficiently.",
        });

        // The whole point: it did NOT throw context_length_exceeded, and it found the needle.
        expect(text).toContain("4242");
        // And it adapted - either grepped, or read a narrow line range (not just repeated full-file reads).
        const narrowed = calls.some((call) => call.startsWith("grep_file(") || /read_file\(\d/.test(call));
        expect(narrowed).toBe(true);

        // Surface the trace so we can SEE how the agent responded to the oversized result.
        // eslint-disable-next-line no-console
        console.log("[eval] tool calls:", calls.join(" -> "));
        // eslint-disable-next-line no-console
        console.log("[eval] answer:", text.trim().slice(0, 120));
    }, 180_000);

    it("recovers when forced into a full read: the nudge redirects it to a narrower call", async () => {
        const session = openModelSession({ openaiApiKey: process.env.OPENAI_API_KEY ?? "" });
        const model = session.getModel({ model: "classifier", tag: "eval-context-limit-forced" });
        const cap = createToolBudget();
        const calls: string[] = [];

        const tools = {
            read_file: tool({
                description:
                    "Read big-config.ts. Pass fromLine/toLine (1-indexed) to read a slice; omit to read it all.",
                inputSchema: z.object({ fromLine: z.number().optional(), toLine: z.number().optional() }),
                execute: async ({ fromLine, toLine }) => {
                    calls.push(`read_file(${fromLine ?? "-"},${toLine ?? "-"})`);
                    const slice =
                        fromLine != null && toLine != null ? LINES.slice(fromLine - 1, toLine).join("\n") : FILE;
                    return cap(slice, {
                        tool: "read_file",
                        mode: "narrow",
                        maxChars: 150_000,
                        hint: "pass fromLine/toLine for the section you need.",
                    });
                },
            }),
            grep_file: tool({
                description: "grep big-config.ts for a substring; returns the matching `N: ...` lines.",
                inputSchema: z.object({ pattern: z.string() }),
                execute: async ({ pattern }) => {
                    calls.push(`grep_file(${pattern})`);
                    const matches = LINES.filter((line) => line.includes(pattern))
                        .slice(0, 80)
                        .join("\n");
                    return cap(matches || "(no matches)", {
                        tool: "grep_file",
                        mode: "narrow",
                        maxChars: 24_000,
                        hint: "a more specific pattern.",
                    });
                },
            }),
        };

        const { text } = await generateText({
            model,
            tools,
            stopWhen: stepCountIs(12),
            prompt:
                "Step 1: call read_file with NO arguments to load big-config.ts. Step 2: find CONFIG_TIMEOUT_MS and " +
                "reply with ONLY its numeric value.",
        });

        expect(text).toContain("4242"); // recovered + found it despite the forced oversized read
        expect(calls.some((call) => call === "read_file(-,-)")).toBe(true); // did the full read -> got nudged
        expect(calls.length).toBeGreaterThan(1); // and made at least one follow-up (narrower) call

        // eslint-disable-next-line no-console
        console.log("[eval-forced] tool calls:", calls.join(" -> "));
        // eslint-disable-next-line no-console
        console.log("[eval-forced] answer:", text.trim().slice(0, 120));
    }, 180_000);
});
