import matter from "gray-matter";

export const VALID_VERBS = new Set(["click", "type", "scroll", "assert", "hover", "drag", "read", "refresh"]);

interface ValidationResult {
    valid: boolean;
    errors: string[];
}

export function validateTestContent(content: string): ValidationResult {
    const errors: string[] = [];

    if (!/^---\n[\s\S]*?\n---/.test(content)) {
        errors.push("Missing frontmatter");
    } else {
        try {
            const { data } = matter(content);
            if (!data.verification || typeof data.verification !== "string" || data.verification.length < 20) {
                errors.push(
                    "Missing or insufficient 'verification' field in frontmatter - must describe WHERE to navigate and WHAT to assert at the source of truth",
                );
            }
        } catch {
            errors.push("Failed to parse frontmatter");
        }
    }

    if (!/\*\*Intent\*\*:/.test(content)) {
        errors.push("Missing **Intent**: section");
    }

    const stepMatches = content.match(/^\d+\.\s+(click|type|scroll|assert|hover|drag|read|refresh):/gm) || [];
    const interactions = stepMatches.filter((s) => /^\d+\.\s+(click|type|drag):/.test(s));
    if (interactions.length < 2) {
        errors.push(`Only ${interactions.length} interaction(s) (minimum 2)`);
    }

    const allSteps = content.match(/^\d+\.\s+(\w+):/gm) || [];
    for (const step of allSteps) {
        const verbMatch = step.match(/^\d+\.\s+(\w+):/);
        if (verbMatch && !VALID_VERBS.has(verbMatch[1]!)) {
            errors.push(`Invalid verb: "${verbMatch[1]}"`);
        }
    }

    const bodyStart = content.indexOf("---", 3);
    const body = bodyStart > -1 ? content.slice(bodyStart + 3) : content;
    const stepsSection = body.slice(body.indexOf("**Steps**") || 0);
    if (/Dynamic:\s/i.test(stepsSection)) {
        errors.push('Contains "Dynamic:" placeholder in steps');
    }

    return { valid: errors.length === 0, errors };
}
