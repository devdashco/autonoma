import { describe, expect, it } from "vitest";
import { mapGenerationVerdictToIssueCategory, mapReplayVerdictToIssueCategory } from "../src/verdict-mapping";

describe("mapGenerationVerdictToIssueCategory", () => {
    it("returns undefined for success (no issue created)", () => {
        expect(mapGenerationVerdictToIssueCategory("success")).toBeUndefined();
    });

    it("maps application_bug to application_bug category", () => {
        expect(mapGenerationVerdictToIssueCategory("application_bug")).toBe("application_bug");
    });

    it("collapses agent_limitation to agent_error category (transitional)", () => {
        expect(mapGenerationVerdictToIssueCategory("agent_limitation")).toBe("agent_error");
    });

    it("collapses plan_mismatch to agent_error category (transitional)", () => {
        expect(mapGenerationVerdictToIssueCategory("plan_mismatch")).toBe("agent_error");
    });
});

describe("mapReplayVerdictToIssueCategory", () => {
    it("maps application_bug to application_bug category", () => {
        expect(mapReplayVerdictToIssueCategory("application_bug")).toBe("application_bug");
    });

    it("maps engine_error to agent_error category (transitional)", () => {
        expect(mapReplayVerdictToIssueCategory("engine_error")).toBe("agent_error");
    });
});
