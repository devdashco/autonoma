import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the interactive prompt + notification + classifier layers so we can drive
// promptOnFailure deterministically without a TTY or a model call.
const CANCEL = Symbol("cancel");
const selectMock = vi.fn();
const textMock = vi.fn();
const classifyMock = vi.fn();

vi.mock("@clack/prompts", () => ({
    select: (...args: unknown[]) => selectMock(...args),
    text: (...args: unknown[]) => textMock(...args),
    isCancel: (v: unknown) => v === CANCEL,
    log: { info: vi.fn(), step: vi.fn(), error: vi.fn(), success: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../src/core/notify", () => ({ notify: vi.fn() }));

vi.mock("../../src/agents/04-recipe-builder/phases/failure-classifier", () => ({
    classifyFailure: (...args: unknown[]) => classifyMock(...args),
}));

import type { AutofixBudget, FailureContext } from "../../src/agents/04-recipe-builder/phases/entity-loop";
import {
    MAX_AUTOFIX_ATTEMPTS,
    formatErrorContext,
    promptOnFailure,
} from "../../src/agents/04-recipe-builder/phases/entity-loop";
import type { FailureSide } from "../../src/agents/04-recipe-builder/phases/failure-classifier";

const fakeModel = {} as FailureContext["model"];

function ctx(budget: AutofixBudget = { attempts: 0 }): FailureContext {
    return { model: fakeModel, recipe: { Account: [{ _alias: "acc_1" }] }, budget };
}

function classifyAs(side: FailureSide, reason = "because") {
    classifyMock.mockResolvedValue({ side, reason });
}

function selectedOptionValues(): string[] {
    const arg = selectMock.mock.calls[0]![0] as { options: { value: string }[] };
    return arg.options.map((o) => o.value);
}

beforeEach(() => {
    selectMock.mockReset();
    textMock.mockReset();
    classifyMock.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("formatErrorContext", () => {
    test("returns empty string for null/undefined", () => {
        expect(formatErrorContext(null)).toBe("");
        expect(formatErrorContext(undefined)).toBe("");
    });

    test("uses a plain string as-is (no double-quoting)", () => {
        expect(formatErrorContext("connection refused")).toBe("\nServer error: connection refused");
    });

    test("JSON-stringifies structured error bodies", () => {
        expect(formatErrorContext({ code: "BAD_REF" })).toBe('\nServer error: {"code":"BAD_REF"}');
    });
});

// The triage classification is informational only: it's passed to the fix agent
// and shown to the user, but it never gates which actions are offered.
describe("promptOnFailure - within budget (no gating)", () => {
    test("hands the raw failure to the agent with no prompt and spends one attempt", async () => {
        classifyAs("recipe", "acc_1 has no matching alias");
        const budget: AutofixBudget = { attempts: 0 };

        const result = await promptOnFailure("Transaction", { code: "BAD_REF" }, ctx(budget), "create");

        expect(selectMock).not.toHaveBeenCalled();
        expect(textMock).not.toHaveBeenCalled();
        expect(budget.attempts).toBe(1);
        expect(result).toEqual({
            feedback:
                'The request failed - read the error and fix the recipe data. (Auto-triage: acc_1 has no matching alias)\nServer error: {"code":"BAD_REF"}',
        });
    });

    test("an 'implementation' verdict does NOT hide the fix - it still goes to the agent", async () => {
        // Regression: an alias / INVALID_BODY error was being mislabeled implementation
        // and the autofix was suppressed. The verdict must no longer gate the action.
        classifyAs("implementation", "looks like handler code");
        const budget: AutofixBudget = { attempts: 0 };

        const result = await promptOnFailure(
            "Profile",
            { code: "INVALID_BODY", error: "`create.Profile` references unknown alias(es): client_1, user_1" },
            ctx(budget),
            "create",
            400,
        );

        expect(selectMock).not.toHaveBeenCalled();
        expect(budget.attempts).toBe(1);
        expect(result).toMatchObject({
            feedback: expect.stringContaining("references unknown alias(es): client_1, user_1"),
        });
        expect((result as { feedback: string }).feedback).toContain("(Auto-triage: looks like handler code)");
    });
});

describe("promptOnFailure - budget spent", () => {
    test("shows the full menu with every option (nothing hidden)", async () => {
        classifyAs("implementation");
        selectMock.mockResolvedValue("skip");
        const budget: AutofixBudget = { attempts: MAX_AUTOFIX_ATTEMPTS };

        const result = await promptOnFailure("Transaction", { code: "BAD_REF" }, ctx(budget), "create");

        expect(selectedOptionValues()).toEqual(["retry", "autofix", "feedback", "skip"]);
        expect(result).toBe("skip");
    });

    test("autofix re-hands the error to the agent and spends an attempt", async () => {
        classifyAs("unclear", "give it another go");
        selectMock.mockResolvedValue("autofix");
        const budget: AutofixBudget = { attempts: MAX_AUTOFIX_ATTEMPTS };

        const result = await promptOnFailure("Account", { code: "X" }, ctx(budget), "create");

        expect(textMock).not.toHaveBeenCalled();
        expect(budget.attempts).toBe(MAX_AUTOFIX_ATTEMPTS + 1);
        expect(result).toEqual({
            feedback:
                'The request failed - read the error and fix the recipe data. (Auto-triage: give it another go)\nServer error: {"code":"X"}',
        });
    });

    test("manual feedback combines the user's explanation with the error context", async () => {
        classifyAs("unclear");
        selectMock.mockResolvedValue("feedback");
        textMock.mockResolvedValue("acc_1 should be account_1");
        const budget: AutofixBudget = { attempts: MAX_AUTOFIX_ATTEMPTS };

        const result = await promptOnFailure("Transaction", { code: "BAD_REF" }, ctx(budget), "create");

        expect(result).toEqual({
            feedback: 'acc_1 should be account_1\nServer error: {"code":"BAD_REF"}',
        });
    });

    test("retry and skip short-circuit without asking for text", async () => {
        classifyAs("unclear");
        selectMock.mockResolvedValueOnce("retry");
        expect(await promptOnFailure("Account", null, ctx({ attempts: MAX_AUTOFIX_ATTEMPTS }), "create")).toBe("retry");

        selectMock.mockResolvedValueOnce("skip");
        expect(await promptOnFailure("Account", null, ctx({ attempts: MAX_AUTOFIX_ATTEMPTS }), "create")).toBe("skip");
        expect(textMock).not.toHaveBeenCalled();
    });
});

describe("promptOnFailure - cancellation", () => {
    test("cancelling the select throws", async () => {
        classifyAs("unclear");
        selectMock.mockResolvedValue(CANCEL);
        await expect(
            promptOnFailure("Account", null, ctx({ attempts: MAX_AUTOFIX_ATTEMPTS }), "create"),
        ).rejects.toThrow("Entity loop cancelled");
    });

    test("cancelling the feedback text throws", async () => {
        classifyAs("unclear");
        selectMock.mockResolvedValue("feedback");
        textMock.mockResolvedValue(CANCEL);
        await expect(
            promptOnFailure("Account", null, ctx({ attempts: MAX_AUTOFIX_ATTEMPTS }), "create"),
        ).rejects.toThrow("Entity loop cancelled");
    });
});
