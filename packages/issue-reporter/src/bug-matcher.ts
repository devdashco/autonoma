import { type LanguageModel, ObjectGenerator } from "@autonoma/ai";
import { logger } from "@autonoma/logger";
import { z } from "zod";

interface CandidateBug {
    id: string;
    title: string;
    description: string;
    status: string;
}

interface IssueForMatching {
    title: string;
    description: string;
}

const bugMatchResultSchema = z.object({
    matchedBugId: z.string().nullable().describe("The ID of the matching bug, or null if no match found"),
    reasoning: z.string().describe("Explanation of why this issue matches (or doesn't match) an existing bug"),
});

type BugMatchResult = z.infer<typeof bugMatchResultSchema>;

const SYSTEM_PROMPT = `You are a bug deduplication assistant. Your job is to determine whether a new issue
report describes the same root cause as an existing tracked bug.

Two reports match if they describe the same underlying problem - not just similar symptoms.
For example, "Login button unresponsive" and "Cannot click Sign In" likely describe the same bug,
but "Login button unresponsive" and "Login page CSS broken" are different bugs even though both
relate to the login page.

Focus on:
- The root cause described in each report
- Whether fixing one would likely fix the other
- Whether they describe the same failure mode

Do NOT match reports that merely affect the same area of the application but have different root causes.`;

export class BugMatcher {
    private readonly objectGenerator: ObjectGenerator<BugMatchResult>;

    constructor(model: LanguageModel) {
        this.objectGenerator = new ObjectGenerator({
            model,
            systemPrompt: SYSTEM_PROMPT,
            schema: bugMatchResultSchema,
            retry: { maxRetries: 3, initialDelayInMs: 200, backoffFactor: 2 },
        });
    }

    async findMatchingBug(
        issue: IssueForMatching,
        candidates: CandidateBug[],
    ): Promise<{ bugId: string; reasoning: string } | undefined> {
        if (candidates.length === 0) return undefined;

        const candidateList = candidates
            .map(
                (bug) =>
                    `- Bug ID: ${bug.id}\n  Title: ${bug.title}\n  Description: ${bug.description}\n  Status: ${bug.status}`,
            )
            .join("\n\n");

        const prompt = `## New Issue
Title: ${issue.title}
Description: ${issue.description}

## Existing Bugs
${candidateList}

Does this new issue match any of the existing bugs? If so, return the matching bug's ID. If not, return null.`;

        try {
            const result = await this.objectGenerator.generate({ userPrompt: prompt });

            if (result.matchedBugId != null) {
                const matchExists = candidates.some((c) => c.id === result.matchedBugId);
                if (!matchExists) {
                    logger.warn("BugMatcher returned non-existent bug ID, treating as no match", {
                        matchedBugId: result.matchedBugId,
                    });
                    return undefined;
                }

                logger.info("BugMatcher found a match", {
                    matchedBugId: result.matchedBugId,
                    reasoning: result.reasoning,
                });
                return { bugId: result.matchedBugId, reasoning: result.reasoning };
            }

            logger.info("BugMatcher found no match among candidates", {
                candidateCount: candidates.length,
                reasoning: result.reasoning,
            });
            return undefined;
        } catch (error) {
            logger.error("BugMatcher failed, treating as no match", error);
            return undefined;
        }
    }
}
