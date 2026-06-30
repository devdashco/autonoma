import { access } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import * as p from "@clack/prompts";
import spawn from "cross-spawn";
import which from "which";
import type { AgentResult } from "./agent";
import { debugLog } from "./debug";
import { notify } from "./notify";

const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

export interface ReviewLoopOptions {
    agentId: string;
    outputDir: string;
    nonInteractive?: boolean;
    onFeedback: (feedback: string) => Promise<AgentResult | undefined>;
    reviewGuidance?: string;
    showPreview?: boolean;
    /**
     * Optional renderer for an inline, human-readable summary of the step's
     * output (e.g. a table of flows). Printed before the review guidance and the
     * feedback prompt. Re-run on every loop iteration so edits are reflected.
     */
    renderSummary?: () => Promise<string | undefined>;
}

function resolvePath(artifact: string, outputDir: string): string {
    if (isAbsolute(artifact)) return artifact;
    return join(outputDir, artifact);
}

export interface EditorOption {
    command: string;
    label: string;
    args: (files: string[]) => string[];
}

const EDITORS: EditorOption[] = [
    { command: "cursor", label: "Cursor", args: (f) => f },
    { command: "code", label: "VS Code", args: (f) => f },
    { command: "zed", label: "Zed", args: (f) => f },
    { command: "nano", label: "nano", args: (f) => [f[0]!] },
    { command: "vim", label: "vim", args: (f) => [f[0]!] },
];

let cachedEditors: EditorOption[] | undefined;

async function detectEditors(): Promise<EditorOption[]> {
    if (cachedEditors) return cachedEditors;
    const available: EditorOption[] = [];
    for (const editor of EDITORS) {
        const path = await which(editor.command, { nothrow: true });
        if (path) available.push(editor);
    }
    cachedEditors = available;
    return available;
}

let preferredEditor: string | undefined;

const TERMINAL_EDITORS = new Set(["nano", "vim"]);

export async function launchEditor(editor: EditorOption, files: string[]): Promise<void> {
    const args = editor.args(files);
    const isTerminalEditor = TERMINAL_EDITORS.has(editor.command);

    await new Promise<void>((resolve) => {
        let settled = false;
        const settle = () => {
            if (settled) return;
            settled = true;
            resolve();
        };

        // cross-spawn resolves `.cmd`/`.bat` launcher shims - e.g. VS Code's
        // `code` on Windows - which a bare child_process.spawn can't exec and
        // would reject with ENOENT.
        const proc = spawn(editor.command, args, { stdio: "inherit" });

        // Always listen for `error`: a GUI launcher that fails to spawn emits it
        // asynchronously, and an unhandled `error` event crashes the process.
        proc.on("error", (err: Error) => {
            p.log.warn(`Couldn't open ${editor.label} (${err.message}). Review the files manually:`);
            for (const f of files) console.log(`    ${CYAN}${f}${RESET}`);
            settle();
        });

        if (isTerminalEditor) {
            // Terminal editors take over stdio - block until the user exits.
            proc.on("close", () => settle());
        } else {
            // GUI launchers return immediately; don't block the review loop waiting
            // for the window to close. Resolve once the process is spawned.
            proc.on("spawn", () => settle());
        }
    });
}

async function openInEditor(files: string[]): Promise<void> {
    const editors = await detectEditors();
    if (editors.length === 0) {
        p.log.warn("No editors found. Review the files manually:");
        for (const f of files) console.log(`    ${CYAN}${f}${RESET}`);
        return;
    }

    if (preferredEditor) {
        const editor = editors.find((e) => e.command === preferredEditor);
        if (editor) {
            const open = await p.confirm({
                message: `Open in ${editor.label}?`,
            });
            if (!p.isCancel(open) && open) {
                await launchEditor(editor, files);
            }
            return;
        }
    }

    const options = editors.map((e) => ({
        value: e.command,
        label: e.label,
    }));

    const selected = await p.select({
        message: "Open output files for review?",
        options: [...options, { value: "skip", label: "No, skip - I'll review later" }],
    });

    if (p.isCancel(selected) || selected === "skip") return;

    const editor = editors.find((e) => e.command === selected)!;

    const remember = await p.select({
        message: `Use ${editor.label} for all future reviews?`,
        options: [
            { value: "always", label: `Yes, always use ${editor.label}` },
            { value: "ask", label: "No, ask me each time" },
        ],
    });

    if (!p.isCancel(remember) && remember === "always") {
        preferredEditor = editor.command;
    }

    await launchEditor(editor, files);
}

async function showResults(result: AgentResult, options: ReviewLoopOptions): Promise<void> {
    console.log("");
    console.log(`  ${GREEN}[${options.agentId}] Step complete.${RESET}`);

    if (result.artifacts.length === 0) {
        const knownFiles = ["AUTONOMA.md", "entity-audit.md", "scenarios.md"];
        for (const f of knownFiles) {
            const fullPath = join(options.outputDir, f);
            try {
                await access(fullPath);
                result.artifacts.push(f);
            } catch (err) {
                debugLog(`Artifact ${f} not present; skipping`, { err });
            }
        }
    }

    const resolvedPaths: string[] = [];
    if (result.artifacts.length > 0) {
        console.log(`  ${DIM}Output files:${RESET}`);
        for (const a of result.artifacts) {
            const fullPath = resolvePath(a, options.outputDir);
            resolvedPaths.push(fullPath);
            console.log(`    ${CYAN}${fullPath}${RESET}`);
        }
    }
    if (result.summary) {
        console.log(`  ${result.summary}`);
    }
    console.log("");

    if (options.renderSummary) {
        const rendered = await options.renderSummary();
        if (rendered) {
            console.log(rendered);
            console.log("");
        }
    }

    if (options.reviewGuidance) {
        p.note(options.reviewGuidance, "What to check");
    }

    const showPreview = options.showPreview !== false;
    if (showPreview && resolvedPaths.length > 0 && !options.nonInteractive) {
        notify("Autonoma", `${options.agentId} step complete - review needed`);
        await openInEditor(resolvedPaths);
    }
}

export async function reviewLoop(
    result: AgentResult | undefined,
    options: ReviewLoopOptions,
): Promise<AgentResult | undefined> {
    if (!result?.success) return result;

    await showResults(result, options);

    if (options.nonInteractive) return result;

    while (true) {
        const input = await p.text({
            message: "Review the output. Press Enter to approve, or type feedback for the agent.",
            placeholder: "Looks good (Enter to approve)",
            defaultValue: "",
        });

        if (p.isCancel(input)) {
            p.log.warn("Cancelled.");
            return result;
        }

        const feedback = input.trim();
        if (feedback === "") {
            p.log.success("Approved - moving on.");
            return result;
        }

        p.log.info(`Sending feedback to ${options.agentId}...`);
        console.log("");

        const revised = await options.onFeedback(feedback);
        if (revised) {
            result = revised;
        }

        await showResults(result, options);
    }
}
