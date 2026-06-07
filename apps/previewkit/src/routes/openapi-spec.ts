const ownerParam = {
    name: "owner",
    in: "path",
    required: true,
    schema: { type: "string" },
    description: "Repository owner (e.g. GitHub organization slug)",
} as const;

const repoParam = {
    name: "repo",
    in: "path",
    required: true,
    schema: { type: "string" },
    description: "Repository name (without owner)",
} as const;

const prParam = {
    name: "pr",
    in: "path",
    required: true,
    schema: { type: "integer", minimum: 0 },
    description: "Pull request number. 0 is reserved for an Application main-branch environment.",
} as const;

const applicationIdParam = {
    name: "applicationId",
    in: "path",
    required: true,
    schema: { type: "string" },
    description: "Application row id (CUID). Look up once from the autonoma dashboard.",
} as const;

export const openApiSpec = {
    openapi: "3.0.3",
    info: {
        title: "Previewkit API",
        version: "0.1.0",
        description:
            "Previewkit provides Vercel-style preview environments for pull requests on Kubernetes. " +
            "This surface creates and tears down preview environments (the heavy Kubernetes + BuildKit pipeline). " +
            "Per-app secrets and environment status now live in the autonoma API under /v1/previewkit/* and are not part of this surface. " +
            "All /v1/* endpoints require an Authorization: Bearer header (autonoma API key or service shared secret); /health is open.",
    },
    servers: [{ url: "/", description: "Current host" }],
    security: [{ bearerAuth: [] }],
    tags: [
        { name: "Health", description: "Liveness probe" },
        {
            name: "Environments",
            description: "On-demand preview environment lifecycle (create, teardown)",
        },
    ],
    paths: {
        "/health": {
            get: {
                tags: ["Health"],
                summary: "Liveness probe",
                responses: {
                    "200": {
                        description: "Service is up",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/HealthResponse" },
                            },
                        },
                    },
                },
            },
        },
        "/v1/environments": {
            post: {
                tags: ["Environments"],
                summary: "Create or redeploy a preview environment",
                description:
                    "Fire-and-forget. Accepts the request, returns 202 with a statusUrl the caller can poll until status is 'ready' or 'failed'. Posts a PR comment and commit status to GitHub while the deploy runs.",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/DeployRequest" },
                        },
                    },
                },
                responses: {
                    "202": {
                        description: "Deploy accepted, running in background",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/DeployAccepted" },
                            },
                        },
                    },
                    "400": {
                        description: "Invalid request body",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
                    },
                },
            },
        },
        "/v1/applications/{applicationId}/0": {
            post: {
                tags: ["Environments"],
                summary: "Deploy an Application's main-branch preview environment",
                description:
                    "Fire-and-forget. Resolves the Application's linked GitHub repository and main branch ref, deploys the current branch head as a stable Previewkit environment, and returns the normal environment status URL. The environment uses prNumber 0 because GitHub PR numbers start at 1.",
                parameters: [applicationIdParam],
                responses: {
                    "202": {
                        description: "Main-branch deploy accepted, running in background",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/ApplicationEnvironmentDeployAccepted" },
                            },
                        },
                    },
                    "404": {
                        description: "Application, linked repository, or main branch ref not found",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
                    },
                    "409": {
                        description:
                            "Application cannot be deployed because it is disabled, unlinked, or has no active GitHub installation",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
                    },
                },
            },
        },
        "/v1/environments/{owner}/{repo}/{pr}": {
            delete: {
                tags: ["Environments"],
                summary: "Tear down a preview environment",
                description: "Fire-and-forget. Deletes the preview namespace and all resources inside it.",
                parameters: [ownerParam, repoParam, prParam],
                responses: {
                    "202": {
                        description: "Teardown accepted",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/TeardownAccepted" },
                            },
                        },
                    },
                    "400": {
                        description: "pr must be a non-negative integer",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
                    },
                },
            },
        },
    },
    components: {
        securitySchemes: {
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                description:
                    "Autonoma API key (`Authorization: Bearer <key>`) for external callers, or the service shared secret for internal autonoma-to-previewkit calls. /health is exempt; every other route requires this.",
            },
        },
        schemas: {
            HealthResponse: {
                type: "object",
                properties: { status: { type: "string", example: "ok" } },
                required: ["status"],
            },
            ErrorResponse: {
                type: "object",
                properties: { error: { type: "string" } },
                required: ["error"],
            },
            DeployRequest: {
                type: "object",
                properties: {
                    repoFullName: { type: "string", example: "acme-corp/my-repo", description: "owner/repo" },
                    prNumber: { type: "integer", minimum: 1, example: 42 },
                    headSha: { type: "string", example: "abc1234deadbeef..." },
                    headRef: { type: "string", example: "feature/new-thing" },
                    cloneUrl: { type: "string", format: "uri", example: "https://github.com/acme-corp/my-repo.git" },
                    baseSha: { type: "string" },
                    baseRef: { type: "string", example: "main" },
                },
                required: ["repoFullName", "prNumber", "headSha", "headRef", "cloneUrl"],
            },
            DeployAccepted: {
                type: "object",
                properties: {
                    accepted: { type: "boolean", example: true },
                    repoFullName: { type: "string" },
                    prNumber: { type: "integer" },
                    statusUrl: { type: "string", example: "/v1/environments/acme-corp/my-repo/42" },
                },
                required: ["accepted", "repoFullName", "prNumber", "statusUrl"],
            },
            ApplicationEnvironmentDeployAccepted: {
                type: "object",
                properties: {
                    accepted: { type: "boolean", example: true },
                    applicationId: { type: "string" },
                    repoFullName: { type: "string", example: "acme-corp/my-repo" },
                    branch: { type: "string", example: "main" },
                    headSha: { type: "string", example: "abc1234deadbeef..." },
                    prNumber: {
                        type: "integer",
                        example: 0,
                        description: "Synthetic environment number for the Application main branch.",
                    },
                    statusUrl: { type: "string", example: "/v1/environments/acme-corp/my-repo/0" },
                },
                required: ["accepted", "applicationId", "repoFullName", "branch", "headSha", "prNumber", "statusUrl"],
            },
            TeardownAccepted: {
                type: "object",
                properties: {
                    accepted: { type: "boolean", example: true },
                    repoFullName: { type: "string" },
                    prNumber: { type: "integer" },
                },
                required: ["accepted", "repoFullName", "prNumber"],
            },
        },
    },
} as const;
