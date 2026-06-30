/**
 * Read the first string-valued property among `keys` off an unknown value.
 *
 * Tool inputs come from the model and occasionally arrive under a synonym key
 * (`filePath` vs `path` vs `file_path`), so callers probe several names. This
 * does that probing without a type assertion and without throwing on shapes
 * that don't match - it simply returns undefined.
 */
export function pickString(source: unknown, keys: string[]): string | undefined {
    if (typeof source !== "object" || source === null) return undefined;
    for (const key of keys) {
        const value = Reflect.get(source, key);
        if (typeof value === "string") return value;
    }
    return undefined;
}
