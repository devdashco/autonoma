import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { type Logger, logger as rootLogger } from "@autonoma/logger";
import matter from "gray-matter";
import { z } from "zod";
import { CASE_SCHEMA_VERSION } from "./frontmatter";

/**
 * A single eval case loaded from disk: the frozen, assembled agent input plus
 * the authored `expected.md` (deterministic frontmatter + judge rubric body).
 */
export interface LoadedCase<TInput, TFrontmatter> {
    /** Case folder name, used as the vitest case label. */
    name: string;
    /** Absolute path to the case folder. */
    dir: string;
    /** Parsed `input.json` - the frozen `XxxAgentInput` with codebase coords + index arrays. */
    input: TInput;
    /** Parsed `expected.md` frontmatter (deterministic checks). */
    frontmatter: TFrontmatter;
    /** The `expected.md` body - the additive LLM-judge rubric. */
    rubric: string;
}

export interface CaseLoaderConfig<TInput, TFrontmatter> {
    /**
     * Directory containing one folder per case, or `undefined` when the corpus
     * root (`DIFFS_EVAL_CASES_DIR`) is unset - in which case zero cases load.
     */
    casesDir: string | undefined;
    /** Schema for `input.json`. */
    inputSchema: z.ZodType<TInput>;
    /** Schema for the `expected.md` frontmatter. */
    frontmatterSchema: z.ZodType<TFrontmatter>;
}

const INPUT_FILE = "input.json";
const EXPECTED_FILE = "expected.md";

/**
 * Load every case folder under `casesDir`. Each folder must contain
 * {@link INPUT_FILE} and {@link EXPECTED_FILE}; folders missing either are
 * skipped with a warning rather than throwing, so a half-captured case never
 * breaks the whole suite. A case whose files fail schema validation does
 * throw - that is an authoring error, not a transient/missing fixture.
 */
export function loadCases<TInput, TFrontmatter>(
    config: CaseLoaderConfig<TInput, TFrontmatter>,
): LoadedCase<TInput, TFrontmatter>[] {
    const logger = rootLogger.child({ name: "loadCases" });
    const { casesDir, inputSchema, frontmatterSchema } = config;

    if (casesDir == null) {
        logger.info("No cases directory configured; loading zero cases");
        return [];
    }

    let entries: string[];
    try {
        entries = readdirSync(casesDir);
    } catch (err) {
        logger.warn("No cases directory found; loading zero cases", { extra: { casesDir, err } });
        return [];
    }

    const cases: LoadedCase<TInput, TFrontmatter>[] = [];

    for (const name of entries) {
        const dir = path.join(casesDir, name);
        if (!statSync(dir).isDirectory()) continue;

        const inputPath = path.join(dir, INPUT_FILE);
        const expectedPath = path.join(dir, EXPECTED_FILE);

        if (!fileExists(inputPath) || !fileExists(expectedPath)) {
            logger.warn("Skipping incomplete case folder", {
                extra: { name, hasInput: fileExists(inputPath), hasExpected: fileExists(expectedPath) },
            });
            continue;
        }

        const input = inputSchema.parse(JSON.parse(readFileSync(inputPath, "utf-8")));
        const { data, content } = matter(readFileSync(expectedPath, "utf-8"));
        warnOnSchemaDrift(name, data, logger);
        const frontmatter = frontmatterSchema.parse(data);

        cases.push({ name, dir, input, frontmatter, rubric: content.trim() });
    }

    logger.info("Loaded eval cases", { extra: { casesDir, count: cases.length } });
    return cases;
}

function fileExists(filePath: string): boolean {
    try {
        return statSync(filePath).isFile();
    } catch {
        return false;
    }
}

const schemaVersionProbe = z.object({ schemaVersion: z.number().int().positive().optional() });

/**
 * Surface corpus-vs-harness drift: the cases corpus lives in a separate private
 * repo, so a case authored against an older frontmatter schema can outlive a
 * change here. This warns (never throws) when a case declares a `schemaVersion`
 * different from {@link CASE_SCHEMA_VERSION}; a case with no declared version is
 * treated as current and ignored.
 */
function warnOnSchemaDrift(name: string, data: unknown, logger: Logger): void {
    const parsed = schemaVersionProbe.safeParse(data);
    if (!parsed.success) return;

    const declared = parsed.data.schemaVersion;
    if (declared != null && declared !== CASE_SCHEMA_VERSION) {
        logger.warn("Eval case schema version drift; re-capture or migrate the case", {
            extra: { name, declaredVersion: declared, currentVersion: CASE_SCHEMA_VERSION },
        });
    }
}
