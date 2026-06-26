import type { BuildLogEvent } from "./build-log-event";

/**
 * Write side of the previewkit build-log relay - the producer-facing mirror of
 * the read-side `LogStore`. The build pipeline appends raw output chunks,
 * phase transitions, and the terminal status through this seam, then `seal`s
 * the environment's stream when the build ends.
 *
 * Implemented by `LokiBuildLogSink` (Grafana Loki). Implementations must be
 * best-effort: a sink outage may never break the build it observes, so errors
 * are logged and swallowed inside the sink.
 */
export interface BuildLogSink {
    append(environmentId: string, event: BuildLogEvent): Promise<void>;
    /**
     * Mark the start of a new build attempt for this environment. Successive
     * attempts (reruns, new commits) share one retention-bounded stream, so the
     * read side replays only from the latest marker - a new attempt's output
     * overwrites prior attempts in the viewer. Best-effort like the rest of the
     * sink; an outage here may never break the build.
     */
    markStart(environmentId: string): Promise<void>;
    /**
     * Mark the start of a new deployment for this environment, in the app-log
     * stream (`source="app"`) rather than the build stream. Runtime app logs are
     * scraped into one retention-bounded stream per environment, so the read side
     * replays a fresh app-log viewer only from the latest marker - a redeploy's
     * runtime output overwrites the prior deployment's lines in the viewer.
     * Best-effort like the rest of the sink; an outage here may never break the
     * deploy.
     */
    markDeploymentStart(environmentId: string): Promise<void>;
    /** Mark the environment's stream finished (e.g. flush buffered lines). */
    seal(environmentId: string): Promise<void>;
    /** Drain buffers and stop timers; called on process shutdown. */
    close?(): Promise<void>;
}
