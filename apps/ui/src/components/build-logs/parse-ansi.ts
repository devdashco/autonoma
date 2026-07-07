/**
 * Minimal ANSI SGR (Select Graphic Rendition) parser for the log viewer.
 *
 * Terminal build output embeds escape sequences like `ESC[2m…ESC[22m`; without parsing,
 * those codes show up as literal `[2m` noise in the log. This turns a line into styled
 * segments so it renders with color/weight instead. Only the SGR subset that build tools
 * actually emit is handled - the 16 foreground colors, bold, dim, italic, underline -
 * mapped to the design-system tokens (no raw colors) so it stays theme-consistent.
 * Background colors and 256-color/truecolor params are ignored, and any non-SGR CSI
 * sequence (cursor moves, erases, ...) is skipped whole - no raw escape byte or leftover
 * `[…`-style code is ever emitted into the rendered text.
 */

// The ESC control byte that opens every sequence. Kept as a named constant rather than a
// regex literal so it never trips `no-control-regex`, and the scan below stays explicit.
const ESC = "\u001b";
// SGR parameters are digits and semicolons only, terminated by `m`. A sequence whose body
// is anything else is some other CSI (cursor move, erase, ...) we don't render.
const SGR_PARAMS = /^[0-9;]*$/;

// ANSI foreground code -> design-system text color class. Bright variants (90-97) reuse the
// same token. Magenta and cyan have no dedicated token, so they map to the nearest accent.
const FG_CLASS: Record<number, string> = {
    30: "text-text-secondary",
    90: "text-text-secondary",
    31: "text-status-critical",
    91: "text-status-critical",
    32: "text-status-success",
    92: "text-status-success",
    33: "text-status-warn",
    93: "text-status-warn",
    34: "text-primary",
    94: "text-primary",
    35: "text-status-high",
    95: "text-status-high",
    36: "text-primary",
    96: "text-primary",
    37: "text-text-primary",
    97: "text-text-primary",
};

interface AnsiStyle {
    color?: string;
    bold: boolean;
    dim: boolean;
    italic: boolean;
    underline: boolean;
}

export interface AnsiSegment {
    text: string;
    /** Combined Tailwind classes for this segment; empty when it should inherit the row color. */
    className: string;
}

/**
 * Split a single line into styled segments. A line with no escape codes yields one segment
 * with an empty `className` (so it inherits the row's color). Escape sequences never appear
 * in any segment's `text`.
 */
export function parseAnsi(line: string): AnsiSegment[] {
    const segments: AnsiSegment[] = [];
    const style: AnsiStyle = { bold: false, dim: false, italic: false, underline: false };

    let buffer = "";
    const flush = () => {
        if (buffer === "") return;
        segments.push({ text: buffer, className: classNameFor(style) });
        buffer = "";
    };

    let i = 0;
    while (i < line.length) {
        if (line[i] === ESC) {
            const csi = readCsi(line, i);
            if (csi != null) {
                // An SGR sequence changes the style, so flush the old-style text first; any other
                // CSI is skipped silently. Either way the sequence itself never renders.
                if (csi.isSgr) {
                    flush();
                    applyCodes(style, csi.params);
                }
                i = csi.end + 1;
                continue;
            }
            // A lone or truncated ESC we can't delimit as a CSI: drop just the ESC byte so it
            // never leaks; any following bytes render as ordinary text.
            i++;
            continue;
        }
        buffer += line[i];
        i++;
    }
    flush();

    if (segments.length === 0) segments.push({ text: line, className: "" });
    return segments;
}

interface CsiSequence {
    /** Index of the sequence's final byte (inclusive). */
    end: number;
    /** True when this is an SGR sequence (`m` final byte with digit/semicolon params) to apply. */
    isSgr: boolean;
    /** The parameter string between `[` and the final byte; only meaningful when `isSgr`. */
    params: string;
}

/**
 * Read a CSI escape sequence at `start` (`ESC[` … a final byte in 0x40-0x7E). Returns its bounds
 * and whether it is an SGR (`m`) sequence, or undefined when `start` is not a delimitable CSI - a
 * lone ESC, an ESC not followed by `[`, or a sequence truncated at the line end.
 */
function readCsi(line: string, start: number): CsiSequence | undefined {
    if (line[start] !== ESC || line[start + 1] !== "[") return undefined;
    for (let i = start + 2; i < line.length; i++) {
        if (!isCsiFinalByte(line[i])) continue;
        const params = line.slice(start + 2, i);
        return { end: i, isSgr: line[i] === "m" && SGR_PARAMS.test(params), params };
    }
    return undefined;
}

/** CSI parameter/intermediate bytes are < 0x40; the sequence ends at the first byte in 0x40-0x7E. */
function isCsiFinalByte(char: string | undefined): boolean {
    if (char == null) return false;
    const code = char.charCodeAt(0);
    return code >= 0x40 && code <= 0x7e;
}

function applyCodes(style: AnsiStyle, raw: string): void {
    // An empty parameter list (`ESC[m`) is shorthand for reset.
    const codes = raw === "" ? [0] : raw.split(";").map((code) => Number(code));
    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code == null) continue;
        if (code === 38 || code === 48) {
            // Extended color: `38;5;n` (256) or `38;2;r;g;b` (truecolor). No token maps cleanly,
            // so skip the mode and its operands rather than misreading them as separate codes.
            const mode = codes[i + 1];
            i += mode === 5 ? 2 : mode === 2 ? 4 : 1;
            continue;
        }
        applyCode(style, code);
    }
}

function applyCode(style: AnsiStyle, code: number): void {
    if (code === 0) {
        resetStyle(style);
        return;
    }
    if (code === 1) {
        style.bold = true;
        return;
    }
    if (code === 2) {
        style.dim = true;
        return;
    }
    if (code === 3) {
        style.italic = true;
        return;
    }
    if (code === 4) {
        style.underline = true;
        return;
    }
    if (code === 22) {
        style.bold = false;
        style.dim = false;
        return;
    }
    if (code === 23) {
        style.italic = false;
        return;
    }
    if (code === 24) {
        style.underline = false;
        return;
    }
    if (code === 39) {
        style.color = undefined;
        return;
    }
    const fg = FG_CLASS[code];
    if (fg != null) style.color = fg;
    // Background colors (40-49, 100-107) and any unknown code are intentionally ignored.
}

function resetStyle(style: AnsiStyle): void {
    style.color = undefined;
    style.bold = false;
    style.dim = false;
    style.italic = false;
    style.underline = false;
}

function classNameFor(style: AnsiStyle): string {
    const classes: string[] = [];
    if (style.color != null) classes.push(style.color);
    if (style.bold) classes.push("font-semibold");
    if (style.dim) classes.push("opacity-60");
    if (style.italic) classes.push("italic");
    if (style.underline) classes.push("underline");
    return classes.join(" ");
}
