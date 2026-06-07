import { env } from "../env";
import { PreviewkitClient } from "./previewkit-client";

/**
 * Shared client for talking to the Previewkit service. Used by the public
 * `/v1/previewkit/*` proxy router, the GitHub webhook forwarder, and the admin
 * redeploy path so all autonoma-API -> Previewkit HTTP traffic goes through one
 * place. Both env vars are optional; when unset the client reports
 * `isConfigured() === false` and callers skip or 503 accordingly.
 */
export const previewkitClient = new PreviewkitClient(env.PREVIEWKIT_URL, env.PREVIEWKIT_SERVICE_SECRET);
