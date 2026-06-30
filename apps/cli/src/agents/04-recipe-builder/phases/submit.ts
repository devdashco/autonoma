import * as p from "@clack/prompts";
import { buildFullRecipe, buildSubmittableRecipe, saveRecipe } from "../recipe";
import type { RecipeBuilderState } from "../state";

export async function runSubmit(
    state: RecipeBuilderState,
    outputDir: string,
    autonomaApiUrl?: string,
    autonomaApiToken?: string,
    autonomaGenerationId?: string,
): Promise<string> {
    const fullCreate = buildFullRecipe(state.entityOrder, state.entities);
    const recipe = buildSubmittableRecipe(fullCreate, "Standard test scenario with realistic data");

    await saveRecipe(outputDir, recipe);
    p.log.success("Recipe saved to recipe.json");

    if (!autonomaApiUrl || !autonomaApiToken || !autonomaGenerationId) {
        p.log.info(
            "Autonoma API credentials not configured - recipe saved locally. Submit manually or configure AUTONOMA_API_URL, AUTONOMA_API_TOKEN, AUTONOMA_GENERATION_ID.",
        );
        return "recipe.json";
    }

    const url = `${autonomaApiUrl}/v1/setup/setups/${autonomaGenerationId}/scenario-recipe-versions`;

    p.log.step("Submitting recipe to Autonoma...");

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${autonomaApiToken}`,
        },
        body: JSON.stringify(recipe),
    });

    if (res.ok) {
        p.log.success(`Recipe submitted successfully (HTTP ${res.status})`);
    } else {
        const text = await res.text();
        p.log.error(`Recipe submission failed (HTTP ${res.status}): ${text}`);
    }

    return "recipe.json";
}
