import { describe, expect, it } from "vitest";
import { parseAnsi } from "./parse-ansi";

// The ESC byte, written as an escape so the test source carries no literal control char.
const ESC = "\u001b";

describe("parseAnsi", () => {
    it("returns a single inheriting segment for a line with no escape codes", () => {
        expect(parseAnsi("packages/db build complete")).toEqual([
            { text: "packages/db build complete", className: "" },
        ]);
    });

    it("maps foreground colors to design-system tokens and resets on 39", () => {
        const line = `${ESC}[34mℹ${ESC}[39m done`;
        expect(parseAnsi(line)).toEqual([
            { text: "ℹ", className: "text-primary" },
            { text: " done", className: "" },
        ]);
    });

    it("applies dim (2) and clears it on 22, like vite build output", () => {
        const line = `${ESC}[2mdist/${ESC}[22mindex.js`;
        expect(parseAnsi(line)).toEqual([
            { text: "dist/", className: "opacity-60" },
            { text: "index.js", className: "" },
        ]);
    });

    it("combines bold and color, and both green + bold for a .d.ts entry", () => {
        const line = `${ESC}[32m${ESC}[1mindex.d.ts${ESC}[22m${ESC}[39m`;
        expect(parseAnsi(line)).toEqual([{ text: "index.d.ts", className: "text-status-success font-semibold" }]);
    });

    it("treats an empty parameter list (ESC[m) as a full reset", () => {
        const line = `${ESC}[1mbold${ESC}[mplain`;
        expect(parseAnsi(line)).toEqual([
            { text: "bold", className: "font-semibold" },
            { text: "plain", className: "" },
        ]);
    });

    it("skips 256-color params without leaking them as text", () => {
        const line = `${ESC}[38;5;208morange${ESC}[39m`;
        // 38;5;208 has no token mapping, so the segment inherits; the params never appear as text.
        expect(parseAnsi(line)).toEqual([{ text: "orange", className: "" }]);
    });

    it("never leaks a raw escape sequence into any segment's text", () => {
        const line = `${ESC}[2mdist/${ESC}[22m${ESC}[1mindex.js${ESC}[22m  ${ESC}[2m45.03 kB${ESC}[22m`;
        for (const segment of parseAnsi(line)) {
            expect(segment.text).not.toContain(ESC);
            expect(segment.text).not.toContain("[");
        }
        expect(
            parseAnsi(line)
                .map((segment) => segment.text)
                .join(""),
        ).toBe("dist/index.js  45.03 kB");
    });

    it("strips a non-SGR CSI sequence whole, leaking neither the escape nor its codes", () => {
        // A cursor-forward `ESC[2C` is not an SGR (`m`) sequence, so it is removed entirely.
        const line = `plain${ESC}[2Ctext`;
        expect(parseAnsi(line)).toEqual([{ text: "plaintext", className: "" }]);
    });

    it("drops a lone ESC not followed by a CSI without leaking the escape byte", () => {
        const line = `a${ESC}b`;
        const result = parseAnsi(line);
        expect(result.map((segment) => segment.text).join("")).toBe("ab");
        for (const segment of result) expect(segment.text).not.toContain(ESC);
    });
});
