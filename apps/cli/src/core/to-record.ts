/**
 * Normalize an unknown value into a string-keyed record so its properties can
 * be read without a type assertion. Non-objects (and null) become an empty
 * record rather than throwing, which suits the defensive walking of external
 * JSON (HTTP responses, parsed front matter) where the shape isn't guaranteed.
 */
export function toRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null) return {};
    const record: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        record[key] = entry;
    }
    return record;
}
