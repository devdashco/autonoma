import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function parseEntityNames(outputDir: string): Promise<string[]> {
    try {
        const content = await readFile(join(outputDir, "entity-audit.md"), "utf-8");
        const names: string[] = [];
        for (const line of content.split("\n")) {
            const match = line.match(/^\s+-\s+name:\s+(.+)$/);
            if (match) names.push(match[1]!.trim());
        }
        return names;
    } catch {
        return [];
    }
}
