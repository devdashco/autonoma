import { CostCollector, MODEL_ENTRIES, ModelRegistry, openRouterProvider, simpleCostFunction } from "@autonoma/ai";

const EVAL_MODEL_ENTRIES = {
    flash: MODEL_ENTRIES.GEMINI_3_FLASH_PREVIEW,
    glm: {
        createModel: () => openRouterProvider.getModel("z-ai/glm-5-turbo"),
        pricing: simpleCostFunction({ inputCostPerM: 0.96, outputCostPerM: 3.2 }),
    },
    kimi: {
        createModel: () => openRouterProvider.getModel("moonshotai/kimi-k2.5"),
        pricing: simpleCostFunction({ inputCostPerM: 0.45, outputCostPerM: 2.2 }),
    },
} as const;

type EvalModelKey = keyof typeof EVAL_MODEL_ENTRIES;

const ACTIVE_MODEL: EvalModelKey = "flash";

/**
 * Creates a model instance for evals.
 * Change ACTIVE_MODEL above to switch between models.
 */
export function createEvalModel() {
    const registry = new ModelRegistry({
        models: EVAL_MODEL_ENTRIES,
    });
    const costCollector = new CostCollector();

    return {
        model: registry.getModel({ model: ACTIVE_MODEL, tag: "diffs-eval" }, costCollector),
        costCollector,
    };
}
