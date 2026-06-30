import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { readEnv } from "../env";

export const DEFAULT_MODEL = "google/gemini-3-flash-preview";

let provider: ReturnType<typeof createOpenRouter> | undefined;

function getProvider() {
    if (provider == null) {
        // Trim so a stray space or newline in the env var doesn't get sent as the
        // key and come back as a confusing "Missing Authentication header".
        const apiKey = readEnv().OPENROUTER_API_KEY?.trim();
        if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
        provider = createOpenRouter({ apiKey });
    }
    return provider;
}

export function getModel(modelId?: string) {
    return getProvider().languageModel(modelId ?? readEnv().OPENROUTER_MODEL ?? DEFAULT_MODEL);
}
