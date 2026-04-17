import { tool } from "ai";
import { z } from "zod";
import type { ScenarioIndex } from "../scenario-index";

const readScenarioSchema = z.object({
    scenarioId: z.string().describe("The id of the scenario to read (obtained from `list_scenarios`)."),
});

export function buildReadScenarioTool(scenarioIndex: ScenarioIndex) {
    return tool({
        description:
            "Read the full details of a specific scenario by id. Returns the scenario's name, description, " +
            "the recipe that defines exactly what data gets seeded (models + fields), and sample metadata from " +
            "a past instance (e.g., the test user's email or role) when available. Use this to verify that a " +
            "scenario seeds the preconditions a new test needs before picking it in `add_test`.",
        inputSchema: readScenarioSchema,
        execute: async ({ scenarioId }) => {
            const scenario = scenarioIndex.getScenario(scenarioId);
            if (scenario == null) {
                return { error: `Scenario "${scenarioId}" not found.` };
            }
            return {
                id: scenario.id,
                name: scenario.name,
                description: scenario.description,
                activeRecipe: scenario.activeRecipe,
                sampleMetadata: scenario.sampleMetadata,
            };
        },
    });
}
