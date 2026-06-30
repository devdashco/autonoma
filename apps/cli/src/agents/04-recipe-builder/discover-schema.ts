import { toRecord } from "../../core/to-record";
import * as sdk from "./http-client";
import type { SdkClientConfig } from "./http-client";
/**
 * Live schema grounding for the recipe builder.
 *
 * The SDK's `discover` action returns the SOURCE OF TRUTH for what each
 * factory accepts: every registered model with its field names, coarse
 * types, and - critically - which fields are required. (See the SDK's
 * `buildSchemaFromFactories` / `schemaToWire`.)
 *
 * Until now the recipe builder never consumed this: it guessed field
 * names and shapes from the markdown entity audit, so a factory whose
 * `inputSchema` required a tenant FK (e.g. `clientId`) - which the SDK
 * does NOT auto-inject - would fail with an opaque HTTP 500 and the only
 * feedback into the fix loop was that raw error. Grounding propose/revise/
 * triage in this schema replaces guessing with fact.
 */
import type { RecipePayload } from "./recipe";

/** One field as reported by the SDK's discover response. */
export interface DiscoverField {
    name: string;
    /** Coarse type string: string | number | integer | boolean | timestamp | json. */
    type: string;
    isRequired: boolean;
    isId: boolean;
    hasDefault: boolean;
}

export interface DiscoverModel {
    name: string;
    tableName: string;
    fields: DiscoverField[];
}

export interface DiscoverSchema {
    /** Keyed by model name (matches the factory registry / audit model names). */
    models: Map<string, DiscoverModel>;
    /** The tenant/scope field the dashboard isolates on, e.g. "organizationId".
     *  The SDK does NOT auto-inject it - factories own the write and the recipe
     *  must supply it explicitly wherever a model declares it. */
    scopeField?: string;
}

/** Parse the wire JSON from a discover response into a typed schema. Returns
 *  undefined when the body doesn't look like a discover schema (defensive). */
export function parseDiscoverBody(body: unknown): DiscoverSchema | undefined {
    if (!body || typeof body !== "object") return undefined;
    const schema = toRecord(body).schema;
    if (!schema || typeof schema !== "object") return undefined;
    const schemaRecord = toRecord(schema);

    const rawModels = schemaRecord.models;
    if (!Array.isArray(rawModels)) return undefined;

    const models = new Map<string, DiscoverModel>();
    for (const m of rawModels) {
        if (!m || typeof m !== "object") continue;
        const mm = toRecord(m);
        if (typeof mm.name !== "string") continue;
        const rawFields = Array.isArray(mm.fields) ? mm.fields : [];
        const fields: DiscoverField[] = [];
        for (const f of rawFields) {
            if (!f || typeof f !== "object") continue;
            const ff = toRecord(f);
            if (typeof ff.name !== "string") continue;
            fields.push({
                name: ff.name,
                type: typeof ff.type === "string" ? ff.type : "string",
                isRequired: ff.isRequired === true,
                isId: ff.isId === true,
                hasDefault: ff.hasDefault === true,
            });
        }
        models.set(mm.name, {
            name: mm.name,
            tableName: typeof mm.tableName === "string" ? mm.tableName : mm.name,
            fields,
        });
    }

    const scopeField =
        typeof schemaRecord.scopeField === "string" && schemaRecord.scopeField.length > 0
            ? schemaRecord.scopeField
            : undefined;

    return { models, scopeField };
}

/**
 * Fetch the live schema from the SDK endpoint. Best-effort: returns null on
 * any network/HTTP/parse failure so it can never block the recipe builder.
 * Discover reflects only the factories CURRENTLY registered, so call it fresh
 * as the developer wires up more entities rather than caching it forever.
 */
export async function fetchDiscoverSchema(config: SdkClientConfig): Promise<DiscoverSchema | undefined> {
    try {
        const res = await sdk.discover(config);
        if (!res.ok) return undefined;
        return parseDiscoverBody(res.body);
    } catch {
        return undefined;
    }
}

/** True for a field the recipe MUST supply: required, not the synthetic id,
 *  and without a factory-side default. */
function isMandatory(field: DiscoverField): boolean {
    return field.isRequired && !field.isId && !field.hasDefault;
}

/**
 * Render a model's field spec for an LLM prompt. Returns undefined when the model
 * isn't in the live schema (factory not registered yet) so callers can fall
 * back to the audit-derived schema instead of asserting a wrong one.
 */
export function renderModelSchema(schema: DiscoverSchema, modelName: string): string | undefined {
    const m = schema.models.get(modelName);
    if (!m) return undefined;

    const lines = m.fields
        .filter((f) => !f.isId)
        .map((f) => {
            const req = isMandatory(f) ? "REQUIRED" : f.hasDefault ? "optional (has default)" : "optional";
            const scopeNote =
                schema.scopeField && f.name === schema.scopeField
                    ? '  ← scope/tenant field - the SDK does NOT auto-fill it; set it explicitly (use a { "_ref": "..." } to the scope entity)'
                    : "";
            return `  - ${f.name}: ${f.type} (${req})${scopeNote}`;
        });

    return `Live schema for "${modelName}" (from the SDK /discover endpoint - this is the SOURCE OF TRUTH; it overrides the entity audit when they disagree):
${lines.join("\n")}

Every REQUIRED field above must be present on every record. Do not send fields that are not listed.`;
}

export interface RecipeValidationProblem {
    model: string;
    /** Index of the offending record within its model's array. */
    recordIndex: number;
    message: string;
}

/**
 * Validate an assembled create payload against the live schema BEFORE sending
 * it, turning blind HTTP 500s into precise, local diagnostics.
 *
 * Conservative by design - it only flags problems it is sure about:
 *  - a model present in the payload AND in the live schema that omits a
 *    mandatory field (required, no default, not the id);
 *  - a `_ref` whose alias is declared by no record in the same payload (the
 *    SDK resolves refs within the request body).
 *
 * Models absent from the live schema (factory not registered yet) are skipped
 * - we can't assert their shape - so this never produces false positives for
 * not-yet-implemented factories.
 */
export function validateRecipeAgainstSchema(recipe: RecipePayload, schema: DiscoverSchema): RecipeValidationProblem[] {
    const problems: RecipeValidationProblem[] = [];

    // Collect every alias declared anywhere in the payload.
    const declaredAliases = new Set<string>();
    for (const records of Object.values(recipe)) {
        for (const rec of records) {
            if (typeof rec._alias === "string") declaredAliases.add(rec._alias);
        }
    }

    for (const [modelName, records] of Object.entries(recipe)) {
        const model = schema.models.get(modelName);
        records.forEach((record, recordIndex) => {
            // Required-field check (only when we know the model's real shape).
            if (model) {
                for (const field of model.fields) {
                    if (!isMandatory(field)) continue;
                    const value = record[field.name];
                    if (value === undefined || value === null) {
                        problems.push({
                            model: modelName,
                            recordIndex,
                            message: `missing required field "${field.name}" (${field.type})`,
                        });
                    }
                }
            }
            // _ref resolvability check (independent of whether the model is known).
            const refs = new Set<string>();
            collectRefs(record, refs);
            for (const alias of refs) {
                if (!declaredAliases.has(alias)) {
                    problems.push({
                        model: modelName,
                        recordIndex,
                        message: `_ref points at "${alias}", which no record in this payload declares with an _alias`,
                    });
                }
            }
        });
    }

    return problems;
}

function collectRefs(value: unknown, out: Set<string>): void {
    if (Array.isArray(value)) {
        for (const v of value) collectRefs(v, out);
    } else if (value !== null && typeof value === "object") {
        const obj = toRecord(value);
        if (typeof obj._ref === "string") {
            out.add(obj._ref);
            return;
        }
        for (const v of Object.values(obj)) collectRefs(v, out);
    }
}

/** Format validation problems into a server-error-shaped string the fix loop
 *  can consume, mirroring how a real HTTP error body reads. */
export function formatValidationProblems(problems: RecipeValidationProblem[]): string {
    const byModel = new Map<string, string[]>();
    for (const p of problems) {
        const key = `${p.model}[${p.recordIndex}]`;
        if (!byModel.has(key)) byModel.set(key, []);
        byModel.get(key)!.push(p.message);
    }
    return [...byModel.entries()].map(([key, msgs]) => `${key}: ${msgs.join("; ")}`).join("\n");
}
