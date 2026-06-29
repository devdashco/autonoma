import { logger as rootLogger } from "@autonoma/logger";
import type { NodeOptions } from "@sentry/node";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

type BeforeSend = NonNullable<NodeOptions["beforeSend"]>;

/**
 * API-specific Sentry `beforeSend` filter. Drops expected client-error tRPC
 * responses (any `TRPCError` mapping to a 4xx HTTP status - NOT_FOUND, BAD_REQUEST,
 * UNAUTHORIZED, FORBIDDEN, CONFLICT, PRECONDITION_FAILED, ...) so they don't create
 * production issues or page on-call. Server errors (5xx, including unhandled errors
 * wrapped as INTERNAL_SERVER_ERROR) are kept.
 *
 * The capture itself is unconditional inside `@sentry/node`'s `trpcMiddleware`, which
 * has no filter knob - so the classification happens here, at send time.
 */
export const dropExpectedClientErrors: BeforeSend = (event, hint) => {
    const error = hint.originalException;
    if (!(error instanceof TRPCError)) return event;

    const status = getHTTPStatusCodeFromError(error);
    const isClientError = status >= 400 && status < 500;
    if (!isClientError) return event;

    rootLogger
        .child({ name: "dropExpectedClientErrors" })
        .debug("Dropping expected client-error tRPC event", { extra: { code: error.code, status } });
    return null;
};
