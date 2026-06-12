import { ApplicationFailure } from "@temporalio/workflow";

/**
 * Unwraps a Temporal failure to the message of its underlying cause.
 *
 * When an activity throws, the workflow observes an `ActivityFailure` whose own
 * message is the generic "Activity task failed"; Temporal serializes the real
 * error as an `ApplicationFailure` on the `.cause` chain. This walks that chain
 * and returns the message of the *first* (shallowest) `ApplicationFailure` -
 * the one just below the generic wrapper, which is the explanatory message the
 * activity author wrote for humans. Deeper `ApplicationFailure`s are the wrapped
 * low-level causes (e.g. a raw "ENOENT"), which read worse. Falls back to the
 * first non-empty `Error` message, then to a generic string.
 */
export function rootFailureMessage(error: unknown): string {
    if (!(error instanceof Error)) {
        return typeof error === "string" && error.length > 0 ? error : "Unknown error";
    }

    let applicationFailureMessage: string | undefined;
    let firstNonEmptyMessage: string | undefined;
    let current: Error | undefined = error;

    while (current != null) {
        if (current.message.length > 0) {
            firstNonEmptyMessage ??= current.message;
            // The shallowest ApplicationFailure is the message we want; once found,
            // nothing deeper can change the result, so stop walking.
            if (current instanceof ApplicationFailure) {
                applicationFailureMessage = current.message;
                break;
            }
        }

        const cause: unknown = current.cause;
        current = cause instanceof Error ? cause : undefined;
    }

    return applicationFailureMessage ?? firstNonEmptyMessage ?? "Unknown error";
}
