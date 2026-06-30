import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type StepStatus = "pending" | "running" | "done" | "failed" | "paused";

export interface PipelineState {
    steps: {
        pagesFinder: StepStatus;
        kb: StepStatus;
        entityAudit: StepStatus;
        scenarioRecipe: StepStatus;
        recipeBuilder: StepStatus;
        testGenerator: StepStatus;
    };
}

const STATE_FILE = ".pipeline-state.json";

export function initialState(): PipelineState {
    return {
        steps: {
            pagesFinder: "pending",
            kb: "pending",
            entityAudit: "pending",
            scenarioRecipe: "pending",
            recipeBuilder: "pending",
            testGenerator: "pending",
        },
    };
}

export async function loadState(outputDir: string): Promise<PipelineState> {
    const path = join(outputDir, STATE_FILE);
    try {
        const raw = await readFile(path, "utf-8");
        const parsed: PipelineState = JSON.parse(raw);
        return parsed;
    } catch {
        return initialState();
    }
}

export async function saveState(outputDir: string, state: PipelineState): Promise<void> {
    const path = join(outputDir, STATE_FILE);
    await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

export type StepName = keyof PipelineState["steps"];

export async function markStep(
    outputDir: string,
    state: PipelineState,
    step: StepName,
    status: StepStatus,
): Promise<PipelineState> {
    const updated = {
        ...state,
        steps: { ...state.steps, [step]: status },
    };
    await saveState(outputDir, updated);
    return updated;
}

export function nextPendingStep(state: PipelineState): StepName | undefined {
    const order: StepName[] = ["pagesFinder", "kb", "entityAudit", "scenarioRecipe", "recipeBuilder", "testGenerator"];
    return order.find((s) => state.steps[s] !== "done") ?? undefined;
}
