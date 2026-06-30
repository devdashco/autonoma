import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toRecord } from "../../core/to-record";
import type { AuditedModel } from "./entity-order";
import type { EntityProgress } from "./state";

export type RecipePayload = Record<string, Record<string, unknown>[]>;

/** Recursively collect every alias referenced via `{ _ref: "..." }` in a value. */
function collectRefs(value: unknown, out: Set<string>): void {
    if (Array.isArray(value)) {
        for (const v of value) collectRefs(v, out);
    } else if (value !== null && typeof value === "object") {
        const obj = toRecord(value);
        if (typeof obj._ref === "string") out.add(obj._ref);
        for (const v of Object.values(obj)) collectRefs(v, out);
    }
}

/**
 * Build the payload for testing a single entity: that entity plus every other
 * entity it depends on, emitted in dependency order (parents before children).
 *
 * The SDK resolves `_ref`s WITHIN the request body, so any alias a record
 * references must be declared by a record in the same request. The recipe agent
 * is free to `_ref` any already-completed entity (not just the audit's
 * `created_by` parents), so we can't rely on the audit chain alone - a `_ref`
 * the audit never recorded as a dependency would otherwise be missing from the
 * payload and fail with "references unknown alias(es)". We therefore include the
 * transitive closure of BOTH the audit's `created_by` owners AND the entities
 * whose aliases actually appear in the recipe data.
 */
export function buildSingleEntityRecipe(
    entityName: string,
    models: AuditedModel[],
    entityOrder: string[],
    allEntities: Record<string, EntityProgress>,
): RecipePayload {
    const modelMap = new Map(models.map((m) => [m.name, m]));

    // Which entity declares each alias, from the data we've accepted so far.
    const aliasOwner = new Map<string, string>();
    for (const [name, entity] of Object.entries(allEntities)) {
        for (const rec of entity?.recipeData ?? []) {
            if (typeof rec._alias === "string") aliasOwner.set(rec._alias, name);
        }
    }

    const recipe: RecipePayload = {};
    const done = new Set<string>();
    const onStack = new Set<string>();

    function include(name: string): void {
        if (done.has(name) || onStack.has(name)) return; // skip done + break cycles
        onStack.add(name);

        const records = allEntities[name]?.recipeData ?? [];

        // Dependencies must be created first: audit-declared owners…
        for (const dep of modelMap.get(name)?.created_by ?? []) {
            if (entityOrder.includes(dep.owner)) include(dep.owner);
        }
        // …plus every entity whose alias this one actually references.
        const refs = new Set<string>();
        collectRefs(records, refs);
        for (const alias of refs) {
            const owner = aliasOwner.get(alias);
            if (owner && owner !== name) include(owner);
        }

        onStack.delete(name);
        done.add(name);
        // Insertion order = dependency order, since deps are added above.
        if (records.length > 0) recipe[name] = records;
    }

    include(entityName);
    return recipe;
}

export function buildFullRecipe(entityOrder: string[], allEntities: Record<string, EntityProgress>): RecipePayload {
    const recipe: RecipePayload = {};

    for (const name of entityOrder) {
        const entity = allEntities[name];
        if (entity?.recipeData && entity.recipeData.length > 0) {
            recipe[name] = entity.recipeData;
        }
    }

    return recipe;
}

export interface FullRecipeJson {
    version: number;
    source: { discoverPath: string; scenariosPath: string };
    validationMode: string;
    recipes: {
        name: string;
        description: string;
        create: RecipePayload;
        validation: {
            status: string;
            method: string;
            up_ms?: number;
            down_ms?: number;
        };
    }[];
}

export function buildSubmittableRecipe(create: RecipePayload, description: string): FullRecipeJson {
    return {
        version: 1,
        source: {
            discoverPath: "discover.json",
            scenariosPath: "scenarios.md",
        },
        validationMode: "endpoint-lifecycle",
        recipes: [
            {
                name: "standard",
                description,
                create,
                validation: {
                    status: "validated",
                    method: "endpoint-up-down",
                },
            },
        ],
    };
}

const RECIPE_FILE = "recipe.json";

export async function saveRecipe(outputDir: string, recipe: FullRecipeJson): Promise<void> {
    await writeFile(join(outputDir, RECIPE_FILE), JSON.stringify(recipe, null, 2), "utf-8");
}

export async function loadRecipe(outputDir: string): Promise<FullRecipeJson | undefined> {
    try {
        const raw = await readFile(join(outputDir, RECIPE_FILE), "utf-8");
        const parsed: FullRecipeJson = JSON.parse(raw);
        return parsed;
    } catch {
        return undefined;
    }
}
