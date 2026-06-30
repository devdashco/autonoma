import readline from "node:readline";
import { settings } from "@clack/core";
import { debugLog } from "./debug";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const SHOW_CURSOR = "\x1b[?25h";

const EXIT_HINT = `${DIM}(press Ctrl+C again to exit)${RESET}`;
const ARM_WINDOW_MS = 3000;
// If the graceful exit (analytics flush -> process.exit) hasn't terminated the
// process within this window, bail unconditionally. onExit defers the real
// process.exit behind an async flush; if that chain ever fails to resolve, this
// is what guarantees the CLI still closes on a plain double-tap.
const FORCE_EXIT_MS = 2500;

let installed = false;
let armed = false;
let armTimer: ReturnType<typeof setTimeout> | undefined;
let onExit: (() => void) | undefined;
let quitting = false;

function disarm(): void {
    if (armTimer) clearTimeout(armTimer);
    armTimer = undefined;
    armed = false;
}

/** Last-resort synchronous exit. Never waits on a promise or the event loop. */
function forceExit(): void {
    restoreTerminal();
    // 130 = 128 + SIGINT, the conventional code for "terminated by Ctrl+C".
    process.exit(130);
}

function handleInterrupt(): void {
    // A graceful exit is already underway. Don't just swallow the signal - if the
    // async flush in onExit stalled, the user is now stuck with no way out. Treat
    // any further press as "get me out NOW" and exit synchronously, bypassing the
    // flush entirely.
    if (quitting) {
        forceExit();
        return;
    }

    if (armed) {
        quitting = true;
        disarm();
        // Failsafe: onExit hands off the real exit to an async analytics flush. If
        // that never lands process.exit, force it. unref so the timer itself can't
        // keep the process alive past a clean exit.
        setTimeout(forceExit, FORCE_EXIT_MS).unref?.();
        onExit?.();
        return;
    }
    // First press: arm a short window and tell the user how to actually exit.
    // Claude Code-style: a second Ctrl+C within the window quits; otherwise it
    // disarms and the run continues untouched.
    armed = true;
    process.stderr.write(`\n${EXIT_HINT}\n`);
    armTimer = setTimeout(disarm, ARM_WINDOW_MS);
}

/**
 * Install Ctrl+C double-press handling and neuter ESC-as-exit.
 *
 * - ESC no longer cancels prompts (the alias is removed).
 * - Ctrl+C requires two presses within a 3s window to quit. The first press
 *   shows a hint; if no second press lands, the run continues.
 *
 * Works both while a clack prompt owns stdin (via a SIGINT listener injected
 * onto each readline interface) and between prompts (via process SIGINT).
 */
export function installInterruptHandler(opts: { onExit: () => void }): void {
    onExit = opts.onExit;
    if (installed) return;
    installed = true;

    // ESC should do nothing. clack maps "escape" -> "cancel" by default and
    // updateSettings can't remove an existing alias, so delete it on the live map.
    settings.aliases.delete("escape");

    // Between prompts (raw mode off), Ctrl+C arrives as a normal process signal.
    process.on("SIGINT", handleInterrupt);

    // During a clack prompt, readline owns stdin in raw mode. Node's readline
    // closes the interface on Ctrl+C ONLY when it has no "SIGINT" listener; if a
    // listener exists it emits "SIGINT" and leaves the prompt running. So inject
    // one onto every interface clack creates.
    const original = readline.createInterface.bind(readline);
    // The one unavoidable assertion in this package: readline.createInterface is
    // an overloaded builtin, and a single-signature wrapper is not structurally
    // assignable to its overload set without bridging the type here.
    readline.createInterface = ((...args: Parameters<typeof readline.createInterface>) => {
        const iface = original(...args);
        iface.on("SIGINT", handleInterrupt);
        return iface;
    }) as typeof readline.createInterface;
}

/** Best-effort terminal restore before an abrupt exit. */
export function restoreTerminal(): void {
    try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch (err) {
        debugLog("Could not restore terminal raw mode", { err });
    }
    process.stdout.write(SHOW_CURSOR);
}
