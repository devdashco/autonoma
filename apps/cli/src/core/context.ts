import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ProjectContext {
    description: string;
    testingGoal: string;
    criticalFlows: string;
    pages?: Array<{ route: string; path: string; description: string }>;
}

const CONTEXT_FILE = ".project-context.json";

export async function saveContext(outputDir: string, ctx: ProjectContext): Promise<void> {
    await writeFile(join(outputDir, CONTEXT_FILE), JSON.stringify(ctx, null, 2), "utf-8");
}

export async function loadContext(outputDir: string): Promise<ProjectContext | undefined> {
    try {
        const raw = await readFile(join(outputDir, CONTEXT_FILE), "utf-8");
        const parsed: ProjectContext = JSON.parse(raw);
        return parsed;
    } catch {
        return undefined;
    }
}

export function formatContext(ctx: ProjectContext): string {
    let output = `## Project Context (from the user)

**What this project is:** ${ctx.description}

**Why they want testing:** ${ctx.testingGoal}

**Critical flows (user-declared - these MUST be covered):** ${ctx.criticalFlows}

These are flows the user explicitly said cannot break. Treat them as authoritative: every one of them must be represented faithfully in your output - never drop or downplay them. Start with these, then expand to cover the rest of the application.`;

    if (ctx.pages?.length) {
        output += `\n\n## Discovered Pages (${ctx.pages.length} routes)\n\n`;
        output += ctx.pages.map((p) => `- \`${p.route}\` - ${p.description} (\`${p.path}\`)`).join("\n");
    }

    return output;
}
