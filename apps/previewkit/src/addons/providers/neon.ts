import { z } from "zod";
import { logger as rootLogger, type Logger } from "../../logger";
import type { AddonProvider, DeprovisionInput, ProvisionInput, ProvisionResult } from "../provider";

const NEON_API_BASE = "https://console.neon.tech/api/v2";

// `parent_branch_id` is intentionally optional: when omitted, Neon's API
// branches off the project's primary branch, which is the right default for
// previewkit users who don't want to memorise branch ids.
const neonOptionsSchema = z.object({
    project_id: z.string().min(1, "project_id is required"),
    parent_branch_id: z.string().optional(),
    database_name: z.string().default("neondb"),
    role_name: z.string().default("neondb_owner"),
});

// `token` is the conventional key inside the org-secret JSON map. Other
// providers will pick different keys; the contract is per-provider.
const neonAuthSchema = z.object({
    token: z.string().min(1, "Neon auth secret must contain a non-empty `token` key"),
});

const neonStateSchema = z.object({
    branchId: z.string(),
    endpointId: z.string().optional(),
});

// Minimal shape of the response payloads we read. Neon returns more
// fields; we only consume what we need so future API additions don't
// require schema updates.
const branchCreateResponseSchema = z.object({
    branch: z.object({ id: z.string() }),
    endpoints: z
        .array(z.object({ id: z.string(), host: z.string() }))
        .min(1, "Neon returned a branch with no endpoints — refusing to continue"),
});

const branchListResponseSchema = z.object({
    branches: z.array(z.object({ id: z.string(), name: z.string() })),
});

const endpointSchema = z.object({
    id: z.string(),
    host: z.string(),
    type: z.string(),
});

const endpointListResponseSchema = z.object({
    endpoints: z.array(endpointSchema),
});

const endpointCreateResponseSchema = z.object({
    endpoint: z.object({ id: z.string(), host: z.string() }),
});

const connectionUriResponseSchema = z.object({ uri: z.string() });

interface ResolvedBranch {
    branchId: string;
    endpoint: { id: string; host: string };
}

export class NeonProvider implements AddonProvider {
    readonly name = "neon";

    private readonly logger: Logger;
    private readonly apiBase: string;

    constructor(apiBase: string = NEON_API_BASE) {
        this.apiBase = apiBase;
        this.logger = rootLogger.child({ name: this.constructor.name });
    }

    async provision(input: ProvisionInput): Promise<ProvisionResult> {
        const options = neonOptionsSchema.parse(input.options);
        const auth = neonAuthSchema.parse(input.authSecret);
        const branchName = `previewkit-pr-${input.prNumber}`;

        this.logger.info("Provisioning Neon branch", {
            projectId: options.project_id,
            branchName,
            parentBranchId: options.parent_branch_id,
            namespace: input.namespace,
        });

        // Find-or-create by branch name. The branch *is* the preview env for
        // this PR, so a retried provision (e.g. the build activity rescheduled
        // after a later failure) must reuse the existing branch rather than
        // create a second `previewkit-pr-<N>`. This is the idempotency the
        // Temporal retry policy relies on.
        const existing = await this.findBranchByName(options.project_id, auth.token, branchName);
        const resolved =
            existing != null
                ? await this.reuseBranch(options.project_id, auth.token, existing.id, branchName)
                : await this.createBranch(options.project_id, auth.token, branchName, options.parent_branch_id);

        const params = new URLSearchParams({
            branch_id: resolved.branchId,
            database_name: options.database_name,
            role_name: options.role_name,
        });
        const conn = connectionUriResponseSchema.parse(
            await this.fetchJson("GET", `/projects/${options.project_id}/connection_uri?${params}`, auth.token),
        );

        this.logger.info("Neon branch provisioned", {
            projectId: options.project_id,
            branchId: resolved.branchId,
            reused: existing != null,
        });

        return {
            outputs: {
                connectionString: conn.uri,
                host: resolved.endpoint.host,
                database: options.database_name,
            },
            state: {
                branchId: resolved.branchId,
                endpointId: resolved.endpoint.id,
            } satisfies z.infer<typeof neonStateSchema>,
        };
    }

    private async findBranchByName(
        projectId: string,
        token: string,
        branchName: string,
    ): Promise<{ id: string } | undefined> {
        const list = branchListResponseSchema.parse(
            await this.fetchJson("GET", `/projects/${projectId}/branches`, token),
        );
        const match = list.branches.find((branch) => branch.name === branchName);
        return match != null ? { id: match.id } : undefined;
    }

    private async createBranch(
        projectId: string,
        token: string,
        branchName: string,
        parentBranchId: string | undefined,
    ): Promise<ResolvedBranch> {
        const createBody: Record<string, unknown> = {
            branch: { name: branchName },
            endpoints: [{ type: "read_write" }],
        };
        if (parentBranchId != null) {
            (createBody.branch as Record<string, unknown>).parent_id = parentBranchId;
        }

        const created = branchCreateResponseSchema.parse(
            await this.fetchJson("POST", `/projects/${projectId}/branches`, token, createBody),
        );
        return { branchId: created.branch.id, endpoint: created.endpoints[0]! };
    }

    /**
     * Reuse an existing branch: find its read_write endpoint, creating one if
     * the branch somehow has none (e.g. a prior run created the branch but
     * failed before the endpoint, or the endpoint was reaped).
     */
    private async reuseBranch(
        projectId: string,
        token: string,
        branchId: string,
        branchName: string,
    ): Promise<ResolvedBranch> {
        this.logger.info("Reusing existing Neon branch", { projectId, branchId, branchName });

        const endpoints = endpointListResponseSchema.parse(
            await this.fetchJson("GET", `/projects/${projectId}/branches/${branchId}/endpoints`, token),
        );
        const readWrite = endpoints.endpoints.find((endpoint) => endpoint.type === "read_write");
        if (readWrite != null) {
            return { branchId, endpoint: { id: readWrite.id, host: readWrite.host } };
        }

        this.logger.warn("Existing Neon branch has no read_write endpoint; creating one", { projectId, branchId });
        const created = endpointCreateResponseSchema.parse(
            await this.fetchJson("POST", `/projects/${projectId}/endpoints`, token, {
                endpoint: { branch_id: branchId, type: "read_write" },
            }),
        );
        return { branchId, endpoint: { id: created.endpoint.id, host: created.endpoint.host } };
    }

    async deprovision(input: DeprovisionInput): Promise<void> {
        const options = neonOptionsSchema.parse(input.options);
        const auth = neonAuthSchema.parse(input.authSecret);
        const state = neonStateSchema.parse(input.state);

        this.logger.info("Deprovisioning Neon branch", {
            projectId: options.project_id,
            branchId: state.branchId,
        });

        await this.fetchJson("DELETE", `/projects/${options.project_id}/branches/${state.branchId}`, auth.token);

        this.logger.info("Neon branch deprovisioned", { branchId: state.branchId });
    }

    private async fetchJson(
        method: "GET" | "POST" | "DELETE",
        path: string,
        token: string,
        body?: unknown,
    ): Promise<unknown> {
        const url = `${this.apiBase}${path}`;
        const res = await fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: body != null ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Neon API ${method} ${path} failed (${res.status}): ${text || res.statusText}`);
        }

        // DELETE returns 200 with a JSON body too, but treat empty 204s safely.
        if (res.status === 204) return {};
        return res.json();
    }
}
