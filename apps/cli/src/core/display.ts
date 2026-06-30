const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

function formatArgs(input: Record<string, unknown>, keys: string[]): string {
    const parts: string[] = [];
    for (const key of keys) {
        if (key in input && input[key] !== undefined && input[key] !== null) {
            parts.push(`${key}=${String(input[key])}`);
        }
    }
    return parts.join(" ");
}

function toolCallSummary(name: string, input: Record<string, unknown>): string {
    switch (name) {
        case "read_file":
        case "read_output": {
            const path = String(input.filePath ?? input.path ?? input.file_path ?? "");
            const range = formatArgs(input, ["offset", "limit"]);
            return range ? `${path} (${range})` : path;
        }
        case "write_file":
            return String(input.filePath ?? input.path ?? input.file_path ?? "");
        case "glob":
            return formatArgs(input, ["pattern", "path"]);
        case "grep":
            return formatArgs(input, ["query", "pattern", "path", "include"]);
        case "bash":
            return String(input.command ?? "");
        case "list_directory":
            return formatArgs(input, ["path", "depth"]);
        case "subagent":
        case "spawn_researcher":
            return String(input.task ?? input.instruction ?? input.prompt ?? "");
        case "write_test":
            return formatArgs(input, ["folder", "filename"]);
        case "enqueue_node":
            return formatArgs(input, ["id", "name"]);
        case "mark_visited":
            return formatArgs(input, ["files"]);
        case "get_coverage":
            return formatArgs(input, ["detail"]);
        case "finish":
            return "";
        default: {
            const keys = Object.keys(input);
            if (keys.length === 0) return "";
            return keys.map((k) => `${k}=${String(input[k])}`).join(" ");
        }
    }
}

const SPINNER_FRAMES = ["◒", "◐", "◓", "◑"];

export interface StepInfo {
    stepNumber: number;
    maxSteps: number;
    reasoningText?: string;
    text: string;
    toolCalls: { name: string; input: Record<string, unknown> }[];
    toolErrors: { name: string; error: unknown }[];
    writtenFiles: string[];
}

export interface ProgressStats {
    filesRead: number;
    filesWritten: number;
}

const CLEAR_LINE = "\x1b[2K\r";

export function createStepLogger(agentId: string, _maxSteps: number) {
    const stats: ProgressStats = {
        filesRead: 0,
        filesWritten: 0,
    };
    let frameIdx = 0;
    let lastSpinnerLine = false;

    function clearSpinner() {
        if (lastSpinnerLine) {
            process.stderr.write(CLEAR_LINE);
            lastSpinnerLine = false;
        }
    }

    function writeSpinner(message: string) {
        const frame = SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length];
        frameIdx++;
        process.stderr.write(`${CLEAR_LINE}  ${DIM}${frame} ${message}${RESET}`);
        lastSpinnerLine = true;
    }

    function writePermanent(message: string) {
        clearSpinner();
        console.log(message);
    }

    function log(info: StepInfo) {
        for (const tc of info.toolCalls) {
            const summary = toolCallSummary(tc.name, tc.input);

            switch (tc.name) {
                case "read_file":
                case "read_output":
                    stats.filesRead++;
                    writeSpinner(`reading ${summary}`);
                    break;

                case "glob":
                    writeSpinner(`glob ${summary}`);
                    break;

                case "grep":
                    writeSpinner(`grep ${summary}`);
                    break;

                case "list_directory":
                    writeSpinner(`listing ${summary}`);
                    break;

                case "bash":
                    writeSpinner(`bash: ${summary}`);
                    break;

                case "write_file": {
                    stats.filesWritten++;
                    const path = String(tc.input.path ?? tc.input.file_path ?? "");
                    writePermanent(`  ${GREEN}✎ write ${path}${RESET}`);
                    break;
                }

                case "write_test":
                    stats.filesWritten++;
                    writePermanent(`  ${GREEN}✎ test ${summary}${RESET}`);
                    break;

                case "finish":
                    // Label which agent/area finished - otherwise a BFS run ends in a
                    // wall of identical "✓ finish" lines with no context.
                    writePermanent(`  ${GREEN}${BOLD}✓ done:${RESET} ${GREEN}${agentId}${RESET}`);
                    break;

                case "subagent":
                case "spawn_researcher":
                    writePermanent(`  ${CYAN}⊕ subagent: ${summary}${RESET}`);
                    break;

                default:
                    writeSpinner(`${tc.name}${summary ? " " + summary : ""}`);
            }
        }

        for (const te of info.toolErrors) {
            writePermanent(`  ${RED}✗ ${te.name}: ${te.error}${RESET}`);
        }

        for (const f of info.writtenFiles) {
            writePermanent(`  ${GREEN}📄 wrote: ${f}${RESET}`);
        }
    }

    function checkpoint(message: string) {
        writePermanent(`  ${YELLOW}▸ ${message}${RESET}`);
    }

    function summary() {
        clearSpinner();
        if (stats.filesRead > 0 || stats.filesWritten > 0) {
            console.log(`  ${DIM}────────────────────────────────${RESET}`);
            console.log(`  ${DIM}files read: ${stats.filesRead} | files written: ${stats.filesWritten}${RESET}`);
        }
    }

    return { log, checkpoint, summary, stats };
}
