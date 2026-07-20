import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env } from "../env";
import type { LanguageModel } from "./model-registry";

/**
 * The minimal provider surface {@link LLMProvider} relies on: a `languageModel` factory. We only
 * resolve language models, so we require just this rather than the full AI SDK `Provider` - which
 * lets partial providers (e.g. OpenRouter's, which omits `embeddingModel` / `specificationVersion`)
 * be wrapped. The `never` parameter keeps the constraint contravariantly permissive across providers
 * whose `languageModel` accepts a narrower model-id union.
 */
interface LanguageModelProvider {
    languageModel(modelId: never): LanguageModel;
}

/** Singleton class to create an LLM provider instance. */
export class LLMProvider<TProvider extends LanguageModelProvider> {
    private instance: TProvider | null = null;

    constructor(private readonly createProvider: () => TProvider) {}

    private getInstance(): TProvider {
        if (this.instance == null) this.instance = this.createProvider();

        // biome-ignore lint/style/noNonNullAssertion: This is never null
        return this.instance!;
    }

    public getModel(modelId: Parameters<TProvider["languageModel"]>[0]): LanguageModel {
        return this.getInstance().languageModel(modelId);
    }
}

// Optional per-provider base URL overrides so self-hosted deploys can route all
// model traffic through one OpenAI/Gemini-compatible gateway (e.g. llm.hostbun.cc)
// instead of hitting each vendor directly. Unset -> the SDK's default vendor URL.
const GROQ_BASE_URL = process.env.GROQ_BASE_URL || undefined;
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || undefined;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || undefined;

export const groqProvider = new LLMProvider(() => createGroq({ apiKey: env.GROQ_KEY, baseURL: GROQ_BASE_URL }));

export const googleProvider = new LLMProvider(() =>
    createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY, baseURL: GEMINI_BASE_URL }),
);

export const openRouterProvider = new LLMProvider(() =>
    createOpenRouter({ apiKey: env.OPENROUTER_API_KEY, baseURL: OPENROUTER_BASE_URL }),
);
