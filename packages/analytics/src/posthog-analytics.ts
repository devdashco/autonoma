import { getObservabilityContext } from "@autonoma/logger";
import * as Sentry from "@sentry/node";
import { PostHog } from "posthog-node";

export class PostHogAnalytics {
    private client?: PostHog;

    init(apiKey: string, host?: string): void {
        this.client = new PostHog(apiKey, { host: host ?? "https://us.i.posthog.com" });
    }

    /**
     * Whether a PostHog client has been initialized (i.e. a key was provided at boot).
     * When false, every `capture(...)` silently no-ops - callers can surface this to
     * explain why analytics-only features are inert in a given environment.
     */
    isEnabled(): boolean {
        return this.client != null;
    }

    /**
     * `groups` ties the event to PostHog group analytics (e.g. `{ organization: orgId }`),
     * so usage can be broken down per customer/organization, not just per user.
     */
    capture(
        distinctId: string,
        event: string,
        properties?: Record<string, unknown>,
        groups?: Record<string, string>,
    ): void {
        const span = Sentry.getActiveSpan();
        const traceId = span != null ? Sentry.spanToJSON(span).trace_id : undefined;

        const observabilityCtx = getObservabilityContext();
        const enriched: Record<string, unknown> = {
            ...observabilityCtx,
            ...properties,
            ...(traceId != null && { $sentry_trace_id: traceId }),
        };

        this.client?.capture({ distinctId, event, properties: enriched, groups });
    }

    async shutdown(): Promise<void> {
        await this.client?.shutdown();
    }
}

export const analytics = new PostHogAnalytics();
