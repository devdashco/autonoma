import { parseEntityAudit, type AuditedModel } from "../04-recipe-builder/entity-order";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

/** Parse the audited models from entity-audit.md (empty on any failure). */
export async function parseAuditedModels(outputDir: string): Promise<AuditedModel[]> {
    try {
        return await parseEntityAudit(outputDir);
    } catch {
        return [];
    }
}

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1).trimEnd() + "…";
}

function pad(s: string, width: number): string {
    return s + " ".repeat(Math.max(0, width - s.length));
}

function creationSource(m: AuditedModel): string {
    if (m.independently_created) {
        return m.creation_function ?? m.creation_file ?? "(own creation API)";
    }
    const parents = m.created_by.map((cb) => cb.owner).filter(Boolean);
    return parents.length ? `← ${parents.join(", ")}` : "(no known creator)";
}

/**
 * Render the entity audit as an aligned terminal table, mirroring the KB flows
 * table. Standalone (independently-created) models are highlighted since those
 * are the ones that get their own factories.
 */
export function renderEntityAuditTable(models: AuditedModel[]): string {
    if (models.length === 0) return "";

    const NAME_MAX = 32;
    const SRC_MAX = 52;

    const rows = models.map((m, i) => ({
        num: String(i + 1),
        name: truncate(m.name, NAME_MAX),
        creation: m.independently_created ? "standalone" : "side-effect",
        source: truncate(creationSource(m).replace(/\s+/g, " ").trim(), SRC_MAX),
    }));

    const numW = Math.max(1, ...rows.map((r) => r.num.length));
    const nameW = Math.max("Entity".length, ...rows.map((r) => r.name.length));
    const critW = Math.max("Creation".length, ...rows.map((r) => r.creation.length));

    const standalone = models.filter((m) => m.independently_created).length;
    const header = `${BOLD}${pad("#", numW)}  ${pad("Entity", nameW)}  ${pad("Creation", critW)}  Created from${RESET}`;
    const sep = `${DIM}${"─".repeat(numW + nameW + critW + SRC_MAX + 6)}${RESET}`;

    const body = rows
        .map((r) => {
            const line = `${pad(r.num, numW)}  ${pad(r.name, nameW)}  ${pad(r.creation, critW)}  ${r.source}`;
            // Highlight standalone models - those get their own factories.
            return r.creation === "standalone" ? `${YELLOW}${line}${RESET}` : line;
        })
        .join("\n");

    const caption = `${DIM}${models.length} models · ${standalone} standalone · ${models.length - standalone} side-effect-only${RESET}`;

    return `${header}\n${sep}\n${body}\n${caption}`;
}
