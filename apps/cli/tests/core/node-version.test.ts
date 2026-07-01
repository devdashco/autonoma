import { describe, expect, test } from "vitest";
import { isSupportedNodeVersion, MIN_NODE } from "../../src/core/node-version";

describe("isSupportedNodeVersion", () => {
    test("blocks versions below the styleText-array floor (Node < 22.13)", () => {
        for (const v of ["18.19.0", "20.11.1", "22.0.0", "22.12.9"]) {
            expect(isSupportedNodeVersion(v)).toBe(false);
        }
    });

    test("allows the exact minimum and above", () => {
        for (const v of ["22.13.0", "22.13.1", "22.99.0", "23.0.0", "24.2.0"]) {
            expect(isSupportedNodeVersion(v)).toBe(true);
        }
    });

    test("the boundary is 22.13, not 22.12", () => {
        expect(isSupportedNodeVersion(`${MIN_NODE.major}.${MIN_NODE.minor - 1}.0`)).toBe(false);
        expect(isSupportedNodeVersion(`${MIN_NODE.major}.${MIN_NODE.minor}.0`)).toBe(true);
    });

    test("fails closed on malformed version strings", () => {
        for (const v of ["", "not-a-version", "22", "v22.13.0"]) {
            expect(isSupportedNodeVersion(v)).toBe(false);
        }
    });
});
