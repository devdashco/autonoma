import { createOpenAI } from "@ai-sdk/openai";
import {
    CostCollector,
    type LanguageModel,
    type ModelEntry,
    type ModelOptions,
    ModelRegistry,
    OPENROUTER_MODEL_ENTRIES,
    simpleCostFunction,
} from "@autonoma/ai";

/**
 * Capability-named registry keys (following the engine's `{fast,smart,genius}-{visual,text}` convention).
 * - `smart-visual`: the cheap/fast tool-loop + vision model (Gemini Flash via OpenRouter), like diffs.
 * - `classifier`: the higher-quality final classifier (native OpenAI gpt-5.6-luna - it needs the native
 *   provider because it fails structured output through OpenRouter).
 */
export type InvestigationModelName = "smart-visual" | "classifier";

export interface InvestigationModelConfig {
    openaiApiKey: string;
    /** Override the classifier model id (default gpt-5.6-luna). */
    classifierModelId?: string;
}

/** A per-run, metered facade over the @autonoma/ai model registry (mirrors the diffs ModelSession). */
export interface ModelSession {
    getModel(options: ModelOptions<InvestigationModelName>): LanguageModel;
    readonly costCollector: CostCollector;
}

const DEFAULT_CLASSIFIER_MODEL = "gpt-5.6-luna";

// gpt-5.6+ reject `tools + reasoning_effort` on /v1/chat/completions and require the Responses API; gpt-5.5
// and earlier stay on Chat Completions (their long-standing path). Compare the parsed numeric version rather
// than a single-digit class so gpt-5.10+ (and gpt-6+) still route to the Responses API.
function classifierUsesResponsesApi(modelId: string): boolean {
    const match = /^gpt-(\d+)(?:\.(\d+))?/.exec(modelId);
    if (match?.[1] == null) return false;
    const major = Number(match[1]);
    const minor = match[2] != null ? Number(match[2]) : 0;
    return major > 5 || (major === 5 && minor >= 6);
}

// Published per-model classifier rates (USD per 1M tokens, input/output) for in-run cost metering. Keyed by
// model id so cost stays accurate across a swap or rollback; update when the published rate changes. An
// unlisted id falls back to Luna's rate (the current default).
const LUNA_RATE = { inputCostPerM: 1, outputCostPerM: 6 };
const CLASSIFIER_RATES: Record<string, { inputCostPerM: number; outputCostPerM: number }> = {
    "gpt-5.5": { inputCostPerM: 5, outputCostPerM: 30 },
    "gpt-5.6-luna": LUNA_RATE,
    "gpt-5.6-terra": { inputCostPerM: 2.5, outputCostPerM: 15 },
};

function classifierPricing(modelId: string) {
    return simpleCostFunction(CLASSIFIER_RATES[modelId] ?? LUNA_RATE);
}

/**
 * Open a metered model session. Reuses @autonoma/ai's ModelRegistry (providers, middleware, monitoring,
 * cost tracking) for the shared OpenRouter Gemini-Flash model, and registers a LOCAL native-OpenAI entry
 * for the gpt-5.6-luna classifier (investigation-specific, so it stays out of the shared registry). The OpenAI
 * key is injected; OpenRouter/Gemini/Groq keys are read by @autonoma/ai from its own env.
 */
export function openModelSession(config: InvestigationModelConfig): ModelSession {
    const openai = createOpenAI({ apiKey: config.openaiApiKey });
    const classifierModelId = config.classifierModelId ?? DEFAULT_CLASSIFIER_MODEL;
    const classifierEntry: ModelEntry = {
        createModel: () =>
            classifierUsesResponsesApi(classifierModelId)
                ? openai.responses(classifierModelId)
                : openai.chat(classifierModelId),
        pricing: classifierPricing(classifierModelId),
    };

    const registry = new ModelRegistry<InvestigationModelName>({
        models: {
            "smart-visual": OPENROUTER_MODEL_ENTRIES.GEMINI_3_FLASH_PREVIEW,
            classifier: classifierEntry,
        },
    });
    const costCollector = new CostCollector();

    return {
        getModel: (options) => registry.getModel(options, costCollector),
        costCollector,
    };
}
