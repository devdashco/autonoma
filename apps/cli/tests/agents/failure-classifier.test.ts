import { describe, expect, test } from "vitest";
import { buildClassifierPrompt } from "../../src/agents/04-recipe-builder/phases/failure-classifier";

describe("buildClassifierPrompt", () => {
    test("includes the entity name, the recipe data, and a structured error body", () => {
        const prompt = buildClassifierPrompt({
            entityName: "Transaction",
            phase: "create",
            error: { code: "BAD_REF", detail: "acc_1 missing" },
            recipe: { Transaction: [{ _ref: "acc_1" }] },
        });

        expect(prompt).toContain('"Transaction"');
        expect(prompt).toContain('"_ref": "acc_1"');
        expect(prompt).toContain('"code": "BAD_REF"');
        // Frames both sides of the triage and prefers honesty over a confident guess.
        expect(prompt).toContain("RECIPE DATA");
        expect(prompt).toContain("IMPLEMENTATION");
        expect(prompt.toLowerCase()).toContain("unclear");
    });

    test("renders a plain-string error as-is rather than JSON-quoting it", () => {
        const prompt = buildClassifierPrompt({
            entityName: "Account",
            phase: "create",
            error: "ECONNREFUSED 127.0.0.1:3000",
            recipe: {},
        });

        expect(prompt).toContain("ECONNREFUSED 127.0.0.1:3000");
        expect(prompt).not.toContain('"ECONNREFUSED');
    });

    test("grounds the model with the primer, phase, valid aliases, audit, and status", () => {
        const prompt = buildClassifierPrompt({
            entityName: "Transaction",
            phase: "teardown",
            httpStatus: 500,
            validRefAliases: "Account: aliases account_1, account_2",
            entityAudit: "independently_created: true; created by: Account",
            error: "boom",
            recipe: {},
        });

        // The primer explains the system under test instead of leaving it implicit.
        expect(prompt).toContain("Environment Factory");
        // Phase, status, and the grounding blocks all make it into the prompt.
        expect(prompt).toContain("DOWN (teardown)");
        expect(prompt).toContain("500");
        expect(prompt).toContain("account_1, account_2");
        expect(prompt).toContain("created by: Account");
    });

    test("notes the absence of parent aliases for a root entity", () => {
        const prompt = buildClassifierPrompt({ entityName: "Account", phase: "create", error: "x", recipe: {} });
        expect(prompt.toLowerCase()).toContain("root entity");
    });

    test("includes the live /discover schema when provided", () => {
        const prompt = buildClassifierPrompt({
            entityName: "User",
            phase: "create",
            error: "boom",
            recipe: {},
            liveSchema: 'Live schema for "User": - clientId: string (REQUIRED)',
        });
        expect(prompt).toContain("Live schema for");
        expect(prompt).toContain("clientId: string (REQUIRED)");
    });

    test("falls back to a clear note when no live schema is available", () => {
        const prompt = buildClassifierPrompt({ entityName: "User", phase: "create", error: "boom", recipe: {} });
        expect(prompt).toContain("no live schema available");
    });
});
