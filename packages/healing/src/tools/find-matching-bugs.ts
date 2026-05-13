import { type LanguageModel, ObjectGenerator } from "@autonoma/ai";
import type { BugStatus, PrismaClient } from "@autonoma/db";
import { type Logger, logger as rootLogger } from "@autonoma/logger";
import { tool } from "ai";
import { z } from "zod";

interface CandidateBug {
    id: string;
    title: string;
    description: string;
    status: BugStatus;
}

const candidateInputSchema = z.object({
    candidateKey: z.string().describe("Stable key the caller uses to correlate the result back to its candidate"),
    title: z.string(),
    description: z.string(),
});

const findMatchingBugsInputSchema = z.object({
    applicationId: z.string().describe("Application to search for matching bugs in"),
    candidates: z
        .array(candidateInputSchema)
        .min(1)
        .describe("New issue candidates to deduplicate against existing bugs"),
});

export type FindMatchingBugsInput = z.infer<typeof findMatchingBugsInputSchema>;

const matchSchema = z.object({
    candidateKey: z.string().describe("The candidateKey provided in the input"),
    matchedBugId: z
        .string()
        .nullable()
        .describe("The ID of an existing bug that matches the candidate, or null if none match"),
    reasoning: z.string().describe("Explanation of why this candidate matches (or doesn't) an existing bug"),
});

const matchResultSchema = z.object({
    matches: z.array(matchSchema),
});

type MatchResult = z.infer<typeof matchResultSchema>;

export interface FindMatchingBugsResult {
    candidateKey: string;
    matchedBugId?: string;
    reasoning: string;
}

const SYSTEM_PROMPT = `You are a bug deduplication assistant. Given a list of new issue candidates and a
list of existing tracked bugs for the same application, you decide which candidates describe the same
underlying problem as an existing bug.

Two reports match if they describe the same root cause - not just similar symptoms. For example,
"Login button unresponsive" and "Cannot click Sign In" likely describe the same bug, but
"Login button unresponsive" and "Login page CSS broken" are different bugs even though both relate
to the login page.

Focus on:
- The root cause described in each report
- Whether fixing one would likely fix the other
- Whether they describe the same failure mode

Do NOT match reports that merely affect the same area of the application but have different root causes.

Return one entry per candidate, preserving the candidateKey provided. If no existing bug matches, set
matchedBugId to null.`;

/**
 * Multi-match bug deduplicator. Loads candidate bugs once per call, runs a
 * single LLM pass against the full batch, and returns one result per input
 * candidate. Used as a tool by HealingAgent when it produces a batch of
 * `report_bug` actions in one iteration.
 */
export class BugMatcher {
    private readonly logger: Logger;
    private readonly objectGenerator: ObjectGenerator<MatchResult>;

    constructor(
        private readonly db: PrismaClient,
        model: LanguageModel,
    ) {
        this.logger = rootLogger.child({ name: this.constructor.name });
        this.objectGenerator = new ObjectGenerator({
            model,
            systemPrompt: SYSTEM_PROMPT,
            schema: matchResultSchema,
            retry: { maxRetries: 3, initialDelayInMs: 200, backoffFactor: 2 },
        });
    }

    async findMatchingBugs(input: FindMatchingBugsInput): Promise<FindMatchingBugsResult[]> {
        this.logger.info("Finding matching bugs", {
            applicationId: input.applicationId,
            candidateCount: input.candidates.length,
        });

        const existing = await this.db.bug.findMany({
            where: { applicationId: input.applicationId },
            select: { id: true, title: true, description: true, status: true },
            orderBy: { lastSeenAt: "desc" },
        });

        if (existing.length === 0) {
            this.logger.info("No existing bugs in application, returning all unmatched");
            return input.candidates.map((c) => ({
                candidateKey: c.candidateKey,
                reasoning: "No existing bugs tracked for this application yet.",
            }));
        }

        const result = await this.runLLM(existing, input.candidates);
        return this.coerce(result, existing, input.candidates);
    }

    private async runLLM(
        existing: CandidateBug[],
        candidates: FindMatchingBugsInput["candidates"],
    ): Promise<MatchResult> {
        const prompt = buildPrompt(existing, candidates);
        return await this.objectGenerator.generate({ userPrompt: prompt });
    }

    private coerce(
        result: MatchResult,
        existing: CandidateBug[],
        candidates: FindMatchingBugsInput["candidates"],
    ): FindMatchingBugsResult[] {
        const existingIds = new Set(existing.map((b) => b.id));
        const byKey = new Map<string, FindMatchingBugsResult>();

        for (const m of result.matches) {
            if (m.matchedBugId != null && !existingIds.has(m.matchedBugId)) {
                this.logger.warn("Model returned non-existent bug ID, treating as unmatched", {
                    candidateKey: m.candidateKey,
                    matchedBugId: m.matchedBugId,
                });
                byKey.set(m.candidateKey, { candidateKey: m.candidateKey, reasoning: m.reasoning });
                continue;
            }
            byKey.set(m.candidateKey, {
                candidateKey: m.candidateKey,
                matchedBugId: m.matchedBugId ?? undefined,
                reasoning: m.reasoning,
            });
        }

        return candidates.map((c) => {
            const match = byKey.get(c.candidateKey);
            if (match != null) return match;
            this.logger.warn("Model omitted a candidate, treating as unmatched", {
                candidateKey: c.candidateKey,
            });
            return { candidateKey: c.candidateKey, reasoning: "Deduper did not return a result for this candidate." };
        });
    }
}

function buildPrompt(existing: CandidateBug[], candidates: FindMatchingBugsInput["candidates"]): string {
    const candidateList = candidates
        .map((c) => `### Candidate ${c.candidateKey}\nTitle: ${c.title}\nDescription: ${c.description}`)
        .join("\n\n");

    const existingList = existing
        .map((b) => `- Bug ID: ${b.id}\n  Status: ${b.status}\n  Title: ${b.title}\n  Description: ${b.description}`)
        .join("\n\n");

    return `## New Issue Candidates

${candidateList}

## Existing Bugs in This Application

${existingList}

For each candidate, decide whether it matches one of the existing bugs. Return an entry per
candidate (one for each candidateKey listed above) with either matchedBugId set to the existing
bug's ID, or matchedBugId set to null if none match.`;
}

/**
 * Build the AI SDK tool form so the agent can call this as `find_matching_bugs(...)`.
 */
export function buildFindMatchingBugsTool(matcher: BugMatcher) {
    return {
        find_matching_bugs: tool({
            description:
                "Search for existing bugs in an application that match a batch of new issue candidates. Use before calling report_bug to deduplicate. Returns one result per candidate, with matchedBugId set when a match is found.",
            inputSchema: findMatchingBugsInputSchema,
            execute: async (input) => {
                return await matcher.findMatchingBugs(input);
            },
        }),
    };
}
