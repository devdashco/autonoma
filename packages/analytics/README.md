# @autonoma/analytics

Server-side event tracking for Autonoma backend services, built on [PostHog](https://posthog.com/) with automatic Sentry trace linking.

## What it does

Provides a singleton `PostHogAnalytics` instance that wraps `posthog-node`. It automatically enriches every captured event with the active Sentry trace ID (`$sentry_trace_id`), linking analytics events to distributed traces. When not initialized (e.g. in dev/test), all calls are safely no-ops.

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `analytics` | `PostHogAnalytics` | Pre-created singleton instance - use this directly |
| `PostHogAnalytics` | class | The class itself, if you need the type |

## Usage

### Initialization

Call `init()` once at app startup. Typically done in the API entrypoint:

```ts
import { analytics } from "@autonoma/analytics";

if (env.POSTHOG_KEY != null) {
    analytics.init(env.POSTHOG_KEY, env.POSTHOG_HOST);
}
```

### Capturing events

```ts
import { analytics } from "@autonoma/analytics";

analytics.capture(userId, "test_generation.completed", {
    generationId,
    applicationId,
    status: "success",
});
```

- `distinctId` - always an explicit user ID (from auth context or job payload)
- `event` - dot-separated event name (e.g. `"test_run.started"`)
- `properties` - optional key-value metadata
- `groups` - optional PostHog group analytics mapping (`{ groupType: groupKey }`), so an event can be attributed to a customer/organization, not just a user

If a Sentry span is active when `capture()` is called, the trace ID is automatically attached as `$sentry_trace_id`.

To break usage down per customer, pass the `groups` argument with the organization group:

```ts
analytics.capture(userId, "mcp.tool_called", { tool, success }, { organization: organizationId });
```

### Shutdown

Flush pending events on process exit:

```ts
await analytics.shutdown();
```

## Architecture notes

- The singleton pattern means you import and use `analytics` anywhere - no dependency injection needed.
- If `init()` is never called, the internal PostHog client stays `undefined` and all `capture()` calls silently do nothing. This keeps dev and test environments clean without conditional logic at call sites.
- Sentry integration uses `@sentry/node` to read the active span and extract the trace ID - no extra configuration required beyond having Sentry initialized.
