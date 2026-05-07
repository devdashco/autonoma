import type { Scope, SeverityLevel, User } from "@sentry/node";
import type { ConsoleLogger } from "./console-logger";
import { env } from "./env";

export type HandledError = Error | null;

export interface UserContext {
    userId: string;
    email: string;
    organizationId: string;
    organizationName: string;
}

export interface TraceContext {
    trace: string;
    baggage: string;
    userContext: UserContext;
    testId?: string;
}

export function asError(error: HandledError | unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    return new Error(String(error));
}

export function getObjectError(error: unknown): Error | undefined {
    if (error instanceof Error) return error;

    if (error != null) return new Error(String(error));

    return undefined;
}

export enum ErrorCategory {
    AUTH = "authentication",
    API = "api_error",
    DATABASE = "database",
    VALIDATION = "validation",
    NETWORK = "network",
    BUSINESS_LOGIC = "business_logic",
    ENGINE = "engine_error",
    INTEGRATION = "integration_error",
}

export abstract class SentryLogger {
    protected executionMode?: "job" | "service";
    protected jobName?: string;
    protected structuredLogger: ConsoleLogger;

    constructor(structuredLogger: ConsoleLogger) {
        this.structuredLogger = structuredLogger;
    }

    abstract setTag(key: string, value: string): void;
    abstract captureMessage(message: string, level: SeverityLevel, extra?: Record<string, unknown>): void;
    abstract captureLog(
        message: string,
        level: SeverityLevel,
        extra?: Record<string, unknown>,
        error?: HandledError,
    ): void;
    abstract captureException(error: HandledError, extra?: Record<string, unknown>, level?: SeverityLevel): void;
    abstract withScope<T>(callback: (scope: Scope) => T): void;
    abstract setUser(user: User): void;
    abstract child(bindings: Record<string, unknown>): SentryLogger;

    setExecutionMode(mode: "job" | "service", jobName?: string) {
        this.executionMode = mode;
        this.jobName = jobName ?? "";

        this.setTag("execution_mode", mode);
        this.setTag("service_type", `navigator-backend-${mode}`);

        if (mode === "job" && jobName) {
            this.setTag("job_name", jobName);
            this.info(`Execution mode set to job: ${jobName}`, { jobName, executionMode: mode });
        } else {
            this.info("Execution mode set to service", { executionMode: mode });
        }
    }

    private enrichWithExecutionContext(extra?: Record<string, unknown>): Record<string, unknown> {
        const enriched = { ...extra };
        if (this.executionMode) {
            enriched.executionMode = this.executionMode;
            if (this.jobName) {
                enriched.jobName = this.jobName;
            }
        }
        return enriched;
    }

    private shouldUseSentry(): boolean {
        return env.NODE_ENV === "production";
    }

    debug(message: string, extra?: Record<string, unknown>) {
        const enrichedExtra = this.enrichWithExecutionContext(extra);

        if (env.DEBUG === "true" || !this.shouldUseSentry()) {
            this.structuredLogger.debug(enrichedExtra, message);
        }
    }

    info(message: string, extra?: Record<string, unknown>) {
        const enrichedExtra = this.enrichWithExecutionContext(extra);

        this.captureLog(message, "info", enrichedExtra);
    }

    warn(message: string, extra?: Record<string, unknown>) {
        const enrichedExtra = this.enrichWithExecutionContext(extra);

        this.captureLog(message, "warning", enrichedExtra);
    }

    error(message: string, errorOrExtra?: unknown, extra?: Record<string, unknown>) {
        const isError = errorOrExtra instanceof Error || errorOrExtra === null;
        const actualError = isError ? (errorOrExtra as HandledError) : undefined;
        const actualExtra = isError ? extra : (errorOrExtra as Record<string, unknown> | undefined);
        const enrichedExtra = this.enrichWithExecutionContext(actualExtra);

        this.captureLog(message, "error", enrichedExtra, actualError);
    }

    fatal(message: string, errorOrExtra?: unknown, extra?: Record<string, unknown>) {
        const isError = errorOrExtra instanceof Error || errorOrExtra === null;
        const actualError = isError ? (errorOrExtra as HandledError) : undefined;
        const actualExtra = isError ? extra : (errorOrExtra as Record<string, unknown> | undefined);
        const enrichedExtra = this.enrichWithExecutionContext(actualExtra);

        this.captureLog(message, "fatal", enrichedExtra, actualError);

        if (actualError) {
            this.captureError(actualError, enrichedExtra, "fatal");
        } else {
            this.captureMessage(message, "fatal", enrichedExtra);
        }
    }

    captureError(error: unknown, extra?: Record<string, unknown>, level: SeverityLevel = "error") {
        const enrichedExtra = this.enrichWithExecutionContext(extra);

        const errorObj = getObjectError(error);

        this.structuredLogger.error({ err: error, ...enrichedExtra }, `Captured error: ${errorObj?.message}`);

        if (this.shouldUseSentry() || level === "fatal") {
            this.withScope((scope) => {
                scope.setLevel(level);
                scope.setTag("fault_type", extra?.fault_type as string);

                if (enrichedExtra) {
                    for (const [key, value] of Object.entries(enrichedExtra)) scope.setExtra(key, value);
                }

                this.captureException(errorObj ?? asError(error));
            });
        }
    }

    setUserContext(user: { id: string; email: string; organizationId: string; role?: string }) {
        this.structuredLogger.info({ user }, "User context set");

        if (this.shouldUseSentry()) {
            this.setUser({
                id: user.id,
                email: user.email,
                username: user.email,
                ip_address: "{{auto}}",
                segment: user.organizationId,
            });

            this.setTag("organization_id", user.organizationId);
            if (user.role) this.setTag("user_role", user.role);
        }
    }
}
