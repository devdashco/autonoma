import { existsSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export function detectPackageManager(projectRoot: string): PackageManager {
    if (existsSync(join(projectRoot, "bun.lock")) || existsSync(join(projectRoot, "bun.lockb"))) return "bun";
    if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(projectRoot, "yarn.lock"))) return "yarn";
    return "npm";
}

export function installCommand(pm: PackageManager, ...packages: string[]): string {
    const pkgs = packages.join(" ");
    switch (pm) {
        case "bun":
            return `bun add ${pkgs}`;
        case "pnpm":
            return `pnpm add ${pkgs}`;
        case "yarn":
            return `yarn add ${pkgs}`;
        case "npm":
            return `npm install ${pkgs}`;
    }
}

export function runCommand(pm: PackageManager): string {
    switch (pm) {
        case "bun":
            return "bun run";
        case "pnpm":
            return "pnpm run";
        case "yarn":
            return "yarn run";
        case "npm":
            return "npm run";
    }
}

export function execCommand(pm: PackageManager, file: string): string {
    switch (pm) {
        case "bun":
            return `bun ${file}`;
        case "pnpm":
            return `pnpm tsx ${file}`;
        case "yarn":
            return `yarn tsx ${file}`;
        case "npm":
            return `npx tsx ${file}`;
    }
}
