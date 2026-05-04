import type { LanguageModel } from "@autonoma/ai";
import { describe, expect, it } from "vitest";
import type { CommandSpec, StepData } from "../../../commands";
import { WaitPlanner } from "./wait-planner";

const fakeModel = {} as unknown as LanguageModel;

function makeStep<TInteraction extends string>(
    interaction: TInteraction,
    params: Record<string, unknown>,
): StepData<CommandSpec> {
    return { interaction, params } as unknown as StepData<CommandSpec>;
}

describe("WaitPlanner.planFirstWait", () => {
    const planner = new WaitPlanner({ model: fakeModel });

    it("derives an interactable condition for click", () => {
        const condition = planner.planFirstWait(makeStep("click", { description: "Login button" }));
        expect(condition).toBe('the element described as "Login button" is visible and interactable');
    });

    it("derives an interactable condition for hover", () => {
        const condition = planner.planFirstWait(makeStep("hover", { description: "user avatar" }));
        expect(condition).toBe('the element described as "user avatar" is visible and interactable');
    });

    it("derives an editable condition for type", () => {
        const condition = planner.planFirstWait(makeStep("type", { description: "email field", text: "user@x.com" }));
        expect(condition).toBe('the input field described as "email field" is visible and editable');
    });

    it("derives a generic loaded condition for scroll", () => {
        const condition = planner.planFirstWait(makeStep("scroll", { direction: "down" }));
        expect(condition).toBe("the page is loaded and scrollable");
    });

    it("returns null for assert (no useful pre-wait)", () => {
        const condition = planner.planFirstWait(makeStep("assert", { instruction: "the dashboard is visible" }));
        expect(condition).toBeNull();
    });

    it("returns null for unknown commands", () => {
        const condition = planner.planFirstWait(makeStep("frobnicate", { foo: "bar" }));
        expect(condition).toBeNull();
    });

    it("returns null when click has no description", () => {
        const condition = planner.planFirstWait(makeStep("click", {}));
        expect(condition).toBeNull();
    });

    it("returns null when type has no description", () => {
        const condition = planner.planFirstWait(makeStep("type", { text: "hello" }));
        expect(condition).toBeNull();
    });

    it("returns null when description is not a string", () => {
        const condition = planner.planFirstWait(makeStep("click", { description: 123 }));
        expect(condition).toBeNull();
    });
});
