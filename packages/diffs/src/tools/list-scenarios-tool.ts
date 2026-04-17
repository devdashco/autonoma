import { tool } from "ai";
import { z } from "zod";
import type { ScenarioIndex } from "../scenario-index";

export function buildListScenariosTool(scenarioIndex: ScenarioIndex) {
    return tool({
        description:
            "List all scenarios (named test data environments) available for this application. " +
            "Each scenario seeds the app with a specific state (e.g., an authenticated user with pre-existing records) " +
            "before a test runs and cleans it up after. Returns id, name, and description. " +
            "Use `read_scenario` to inspect a specific scenario's seeded data in detail.",
        inputSchema: z.object({}),
        execute: async () => {
            const scenarios = scenarioIndex.listScenarios();
            return { scenarios };
        },
    });
}
