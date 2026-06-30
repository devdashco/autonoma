import hljs from "highlight.js";

const RESET = "\x1b[0m";

const ANSI: Record<string, string> = {
    reset: RESET,
    keyword: "\x1b[35m",
    string: "\x1b[32m",
    number: "\x1b[33m",
    comment: "\x1b[2m",
    built_in: "\x1b[33m",
    type: "\x1b[33m",
    title: "\x1b[36m",
    literal: "\x1b[35m",
    attr: "",
    params: "",
    function: "\x1b[36m",
    property: "",
    punctuation: "\x1b[2m",
    operator: "",
    variable: "",
    subst: "\x1b[36m",
    "template-variable": "\x1b[36m",
    meta: "\x1b[2m",
    regexp: "\x1b[31m",
};

function spanReplacer(_match: string, cls: string): string {
    const mainCls = cls.split(" ")[0]!;
    return ANSI[mainCls] ?? "";
}

function htmlToAnsi(html: string): string {
    return html
        .replace(/<span class="hljs-([^"]+)">/g, spanReplacer)
        .replace(/<\/span>/g, RESET)
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');
}

export function highlightCode(code: string, language = "typescript"): string {
    try {
        const result = hljs.highlight(code, { language, ignoreIllegals: true });
        return htmlToAnsi(result.value);
    } catch {
        return code;
    }
}

export function codeNoteFormat(line: string): string {
    if (line.includes("\x1b[")) return line;
    return highlightCode(line);
}
