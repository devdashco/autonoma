import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const AUTONOMA_HOME = join(homedir(), ".autonoma");

export function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function getOutputDir(projectSlug: string): string {
    return join(AUTONOMA_HOME, projectSlug);
}

export async function ensureOutputDir(projectSlug: string): Promise<string> {
    const dir = getOutputDir(projectSlug);
    await mkdir(dir, { recursive: true });
    return dir;
}

export async function ensureSubDir(projectSlug: string, ...parts: string[]): Promise<string> {
    const dir = join(getOutputDir(projectSlug), ...parts);
    await mkdir(dir, { recursive: true });
    return dir;
}
