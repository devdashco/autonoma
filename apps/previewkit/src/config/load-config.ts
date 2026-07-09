import { db } from "@autonoma/db";
import { z } from "zod";
import { logger as rootLogger } from "../logger";
import { resolveConfig } from "./resolver";
import type { PreviewConfig } from "./schema";

/** A multirepo dependency's config, resolved from the primary config's `dependencyDocuments`. */
export interface DependencyConfig {
    /** Repo full name (`owner/repo`). */
    repo: string;
    config: PreviewConfig;
}

export interface LoadedConfig {
    config: PreviewConfig;
    /** Dependency-repo configs owned by this (primary) config; [] for single-repo projects. */
    dependencyConfigs: DependencyConfig[];
}

const storedDependencyDocumentsSchema = z.array(z.object({ repo: z.string(), document: z.unknown() }));

/**
 * Loads and resolves an Application's preview config - the single (latest-only)
 * `PreviewkitConfig` row - through `resolveConfig` (schema validation is the
 * only compatibility layer; there is no version-upgrade step).
 *
 * Returns undefined when the Application has no config row (the normal "this
 * repo hasn't adopted server-side config" signal). Throws on an invalid stored
 * document, and unexpected DB errors propagate, so the caller's deploy-level
 * error handling marks the deploy failed rather than silently skipping it.
 */
export async function loadConfig(applicationId: string): Promise<LoadedConfig | undefined> {
    const logger = rootLogger.child({ name: "loadConfig" });
    logger.info("Loading preview config", { applicationId });

    const stored = await db.previewkitConfig.findUnique({
        where: { applicationId },
        select: { document: true, dependencyDocuments: true },
    });
    if (stored == null) {
        logger.info("No preview config for application", { applicationId });
        return undefined;
    }

    logger.info("Resolving preview config", { applicationId });
    // Stored configs are platform-authored, so per-app/service `resources`
    // overrides are trusted and honored here.
    const config = resolveConfig({ document: stored.document, allowCustomResources: true });
    const dependencyConfigs = resolveDependencyConfigs(stored.dependencyDocuments, logger);
    return { config, dependencyConfigs };
}

/**
 * Resolves the primary config's stored `dependencyDocuments` (one validated
 * config per multirepo dependency) through the same validation as the primary.
 * A shape that no longer parses degrades to [] (logged) rather than failing the
 * whole deploy on a corrupt sidecar.
 */
function resolveDependencyConfigs(value: unknown, logger: ReturnType<typeof rootLogger.child>): DependencyConfig[] {
    if (value == null) return [];
    const parsed = storedDependencyDocumentsSchema.safeParse(value);
    if (!parsed.success) {
        logger.warn("Stored dependencyDocuments did not parse; treating as single-repo");
        return [];
    }
    return parsed.data.map((entry) => ({
        repo: entry.repo,
        config: resolveConfig({ document: entry.document, allowCustomResources: true }),
    }));
}
