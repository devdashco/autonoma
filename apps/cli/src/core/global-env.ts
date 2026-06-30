import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENV_KEYS } from "../env";

const AUTONOMA_HOME = join(homedir(), ".autonoma");
const GLOBAL_ENV_PATH = join(AUTONOMA_HOME, ".env");

export function getGlobalEnvPath(): string {
    return GLOBAL_ENV_PATH;
}

function parseEnvContent(content: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        out[key] = value;
    }
    return out;
}

/**
 * Load `~/.autonoma/.env` into process.env as a fallback. Existing process.env
 * values (real shell env, project .env loaded earlier) always win.
 */
export function loadGlobalEnv(): void {
    let content: string;
    try {
        content = readFileSync(GLOBAL_ENV_PATH, "utf-8");
    } catch {
        return;
    }
    for (const [key, value] of Object.entries(parseEnvContent(content))) {
        if (ENV_KEYS.includes(key) && !(key in process.env)) {
            process.env[key] = value;
        }
    }
}

/**
 * Upsert a key in `~/.autonoma/.env` and reflect it in process.env immediately.
 * Preserves other lines/comments in the file.
 */
export function setGlobalEnv(key: string, value: string): void {
    mkdirSync(AUTONOMA_HOME, { recursive: true });

    let lines: string[] = [];
    try {
        lines = readFileSync(GLOBAL_ENV_PATH, "utf-8").split("\n");
    } catch {
        lines = [];
    }

    const serialized = `${key}=${value}`;
    let replaced = false;
    lines = lines.map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || !trimmed.includes("=")) return line;
        const lineKey = trimmed.slice(0, trimmed.indexOf("=")).trim();
        if (lineKey === key) {
            replaced = true;
            return serialized;
        }
        return line;
    });

    if (!replaced) {
        if (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
            lines.splice(lines.length - 1, 0, serialized);
        } else {
            lines.push(serialized);
        }
    }

    const output = lines.join("\n").replace(/\n*$/, "\n");
    writeFileSync(GLOBAL_ENV_PATH, output, { encoding: "utf-8", mode: 0o600 });

    process.env[key] = value;
}
