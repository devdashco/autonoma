import type { PrismaClient } from "@autonoma/db";
import { ScenarioIndex } from "@autonoma/diffs";

/**
 * Load the application's scenarios (named test data environments) into a
 * {@link ScenarioIndex}. Shared by the diffs analysis assembler (so the diffs
 * agent can bind a `scenarioId` when authoring a new test) and the healing
 * assembler (so healing can ground an `update_plan` rewrite in seeded data), so
 * both surfaces see the same scenario detail: each scenario's active recipe and
 * a sample of recent successful instance metadata.
 */
export async function loadScenarioIndex(db: PrismaClient, applicationId: string): Promise<ScenarioIndex> {
    const scenarios = await db.scenario.findMany({
        where: { applicationId, isDisabled: false },
        select: {
            id: true,
            name: true,
            description: true,
            activeRecipeVersion: {
                select: { fingerprint: true, fixtureJson: true, validationStatus: true },
            },
            instances: {
                where: { status: "UP_SUCCESS" },
                orderBy: { upAt: "desc" },
                take: 3,
                select: { metadata: true },
            },
        },
    });

    const details = scenarios.map((s) => {
        const sample = s.instances.find((i) => i.metadata != null);
        return {
            id: s.id,
            name: s.name,
            description: s.description ?? undefined,
            activeRecipe:
                s.activeRecipeVersion != null
                    ? {
                          fingerprint: s.activeRecipeVersion.fingerprint,
                          fixtureJson: s.activeRecipeVersion.fixtureJson,
                          validationStatus: s.activeRecipeVersion.validationStatus,
                      }
                    : undefined,
            sampleMetadata: sample?.metadata ?? undefined,
        };
    });

    return new ScenarioIndex(details);
}
