import { ApplicationFailure } from "@temporalio/workflow";
import { describe, expect, it } from "vitest";
import { rootFailureMessage } from "../src/root-failure-message";

describe("rootFailureMessage", () => {
    it("returns the message of a plain Error", () => {
        expect(rootFailureMessage(new Error("boom"))).toBe("boom");
    });

    it("returns a string thrown directly", () => {
        expect(rootFailureMessage("just a string")).toBe("just a string");
    });

    it("falls back for non-Error, non-string values", () => {
        expect(rootFailureMessage(undefined)).toBe("Unknown error");
        expect(rootFailureMessage({ kind: "weird" })).toBe("Unknown error");
        expect(rootFailureMessage("")).toBe("Unknown error");
    });

    it("unwraps the generic wrapper to the underlying ApplicationFailure cause", () => {
        // Mirrors how Temporal nests the real error: a generic wrapper
        // ("Activity task failed") whose cause is the serialized ApplicationFailure.
        const cause = new ApplicationFailure("Webhook returned 500");
        const wrapper = new Error("Activity task failed", { cause });

        expect(rootFailureMessage(wrapper)).toBe("Webhook returned 500");
    });

    it("prefers an ApplicationFailure over a deeper plain Error cause", () => {
        const networkError = new Error("ECONNREFUSED");
        const appFailure = new ApplicationFailure(
            "Scenario webhook timed out",
            undefined,
            undefined,
            undefined,
            networkError,
        );
        const wrapper = new Error("Activity task failed", { cause: appFailure });

        expect(rootFailureMessage(wrapper)).toBe("Scenario webhook timed out");
    });

    it("returns the shallowest ApplicationFailure, not the deepest wrapped cause", () => {
        // Activity authors wrap a low-level cause with an explanatory message;
        // Temporal serializes the whole chain into nested ApplicationFailures.
        // The shallowest one (just below the generic wrapper) is the human-
        // authored message we want - not the raw "ENOENT" buried beneath it.
        const rawCause = new ApplicationFailure("ENOENT: no such file or directory");
        const authored = new ApplicationFailure(
            "Scenario job completed but did not write the instance ID file",
            undefined,
            undefined,
            undefined,
            rawCause,
        );
        const wrapper = new Error("Activity task failed", { cause: authored });

        expect(rootFailureMessage(wrapper)).toBe("Scenario job completed but did not write the instance ID file");
    });

    it("returns the first non-empty message when no ApplicationFailure is present, skipping empty ones", () => {
        const innermost = new Error("innermost cause");
        const middle = new Error("middle cause", { cause: innermost });
        const outer = new Error("", { cause: middle });

        // Outer message is empty (skipped), so the shallowest non-empty wins.
        expect(rootFailureMessage(outer)).toBe("middle cause");
    });

    it("returns an ApplicationFailure's own message when it has no cause", () => {
        expect(rootFailureMessage(new ApplicationFailure("scenario down"))).toBe("scenario down");
    });
});
