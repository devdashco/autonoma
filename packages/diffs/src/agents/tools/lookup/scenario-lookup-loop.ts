import type { AgentLoop } from "@autonoma/ai";
import type { ScenarioIndex } from "../../../scenario-index";

/**
 * Loop that exposes named test data environments. Consumed by `list_scenarios` and `read_scenario`,
 * and indirectly when grounding a test's preconditions (the diffs agent binding a `create_test`, or
 * healing grounding an `update_plan` rewrite).
 */
export interface ScenarioLookupLoop extends AgentLoop {
    readonly scenarioIndex: ScenarioIndex;
}
