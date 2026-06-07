import { describe, expect, it } from "vitest";
import { toEnvironmentStatus } from "../../../src/previewkit/previewkit-environments.service";

const baseRow = {
    status: "ready",
    phase: "deploying",
    error: null,
    urls: { web: "https://web.preview", api: "https://api.preview" },
    headSha: "abc123",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-02T00:00:00.000Z"),
};

describe("toEnvironmentStatus", () => {
    it("maps a row to the public status shape", () => {
        expect(toEnvironmentStatus("owner/repo", 5, baseRow)).toEqual({
            repoFullName: "owner/repo",
            prNumber: 5,
            status: "ready",
            phase: "deploying",
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
            updatedAt: new Date("2024-01-02T00:00:00.000Z"),
            lastDeployedSha: "abc123",
            urls: { web: "https://web.preview", api: "https://api.preview" },
            error: undefined,
        });
    });

    it("converts null phase and error to undefined", () => {
        const status = toEnvironmentStatus("o/r", 1, { ...baseRow, phase: null, error: null });
        expect(status.phase).toBeUndefined();
        expect(status.error).toBeUndefined();
    });

    it("surfaces an error message when present", () => {
        expect(toEnvironmentStatus("o/r", 1, { ...baseRow, error: "build failed" }).error).toBe("build failed");
    });

    it("keeps only string url values and tolerates non-object urls", () => {
        expect(toEnvironmentStatus("o/r", 1, { ...baseRow, urls: { web: "https://x", bad: 42 } }).urls).toEqual({
            web: "https://x",
        });
        expect(toEnvironmentStatus("o/r", 1, { ...baseRow, urls: null }).urls).toEqual({});
        expect(toEnvironmentStatus("o/r", 1, { ...baseRow, urls: "nope" }).urls).toEqual({});
        expect(toEnvironmentStatus("o/r", 1, { ...baseRow, urls: ["a", "b"] }).urls).toEqual({});
    });
});
