import { readEnv } from "../env";

/**
 * Emit a diagnostic breadcrumb to stderr, gated behind AUTONOMA_DEBUG.
 *
 * The CLI drives its interactive UI on stderr, so benign swallowed errors (file
 * not found, optional cleanup, best-effort telemetry) are logged here rather
 * than polluting normal output or being silently discarded. Set AUTONOMA_DEBUG=1
 * to surface them when investigating.
 */
export function debugLog(message: string, context?: Record<string, unknown>): void {
    const flag = readEnv().AUTONOMA_DEBUG;
    if (flag !== "1" && flag !== "true") return;
    const suffix = context != null ? ` ${JSON.stringify(context, replaceErrors)}` : "";
    process.stderr.write(`[autonoma:debug] ${message}${suffix}\n`);
}

function replaceErrors(_key: string, value: unknown): unknown {
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
    return value;
}
