import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { glob } from "glob";

export async function loadGitignorePatterns(projectRoot: string): Promise<string[]> {
    const patterns: string[] = [
        "**/node_modules/**",
        "**/dist/**",
        "**/.git/**",
        "**/build/**",
        "**/.next/**",
        "**/.nuxt/**",
        "**/coverage/**",
        "**/.turbo/**",
        "**/__pycache__/**",
        "**/.venv/**",
        "**/venv/**",
        "**/.cache/**",
        "**/.parcel-cache/**",
    ];

    const matches = await glob("**/.gitignore", { cwd: projectRoot, dot: true });
    for (const match of matches) {
        const fullPath = join(projectRoot, match);
        try {
            const content = await readFile(fullPath, "utf-8");
            const prefix = relative(projectRoot, join(projectRoot, match, ".."));
            const parsed = parseGitignore(content, prefix);
            patterns.push(...parsed);
        } catch (err) {
            // unreadable gitignore, skip
            console.error(`there was an error trying to read the gitignore on ${fullPath}. skipping.`, err);
        }
    }

    return [...new Set(patterns)];
}

export function parseGitignore(content: string, prefix = ""): string[] {
    return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => gitignoreToGlob(line, prefix));
}

function gitignoreToGlob(pattern: string, prefix: string): string {
    let negated = false;
    if (pattern.startsWith("!")) {
        negated = true;
        pattern = pattern.slice(1);
    }

    if (pattern.startsWith("/")) {
        pattern = pattern.slice(1);
        if (prefix) pattern = `${prefix}/${pattern}`;
    } else if (!pattern.includes("/")) {
        pattern = prefix ? `${prefix}/**/${pattern}` : `**/${pattern}`;
    } else {
        if (prefix) pattern = `${prefix}/${pattern}`;
    }

    if (pattern.endsWith("/")) {
        pattern = `${pattern}**`;
    }

    return negated ? `!${pattern}` : pattern;
}
