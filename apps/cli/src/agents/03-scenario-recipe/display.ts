export function formatEntityTable(entityName: string, records: Record<string, unknown>[]): string {
    if (records.length === 0) {
        return `${entityName}: (no records)`;
    }

    const keys = Object.keys(records[0]!);
    const maxWidths = new Map<string, number>();

    for (const key of keys) {
        maxWidths.set(key, key.length);
    }

    for (const record of records) {
        for (const key of keys) {
            const val = String(record[key] ?? "");
            const current = maxWidths.get(key) ?? 0;
            maxWidths.set(key, Math.max(current, val.length));
        }
    }

    const pad = (s: string, width: number) => s + " ".repeat(Math.max(0, width - s.length));

    const header = keys.map((k) => pad(k, maxWidths.get(k)!)).join(" | ");
    const separator = keys.map((k) => "-".repeat(maxWidths.get(k)!)).join("-+-");
    const rows = records.map((record) => keys.map((k) => pad(String(record[k] ?? ""), maxWidths.get(k)!)).join(" | "));

    const lines = [
        `  ${entityName} (${records.length} records)`,
        `  ${header}`,
        `  ${separator}`,
        ...rows.map((r) => `  ${r}`),
    ];

    return lines.join("\n");
}

export interface EnumGap {
    field: string;
    covered: string[];
    missing: string[];
}

export function findEnumGaps(records: Record<string, unknown>[], enumFields: Record<string, string[]>): EnumGap[] {
    const gaps: EnumGap[] = [];

    for (const [field, possibleValues] of Object.entries(enumFields)) {
        const seen = new Set<string>();
        for (const record of records) {
            const val = record[field];
            if (typeof val === "string") seen.add(val);
        }
        const covered = possibleValues.filter((v) => seen.has(v));
        const missing = possibleValues.filter((v) => !seen.has(v));
        if (missing.length > 0) {
            gaps.push({ field, covered, missing });
        }
    }

    return gaps;
}

export function formatEnumGaps(gaps: EnumGap[]): string {
    if (gaps.length === 0) return "  All enum values covered";

    return gaps
        .map((g) => {
            const coveredStr = g.covered.map((v) => `${v} +`).join(", ");
            const missingStr = g.missing.map((v) => `${v} -`).join(", ");
            return `  ${g.field}: [${coveredStr}, ${missingStr}] - missing: ${g.missing.join(", ")}`;
        })
        .join("\n");
}
