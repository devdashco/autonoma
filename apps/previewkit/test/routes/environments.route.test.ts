import type { AuthCaller, CallerAuthVariables } from "@autonoma/auth";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitProvider } from "../../src/git-provider/git-provider";
import type { PreviewPipeline } from "../../src/pipeline/preview-pipeline";
import type { TeardownPipeline } from "../../src/pipeline/teardown-pipeline";
import { createEnvironmentsRoute, MAIN_BRANCH_ENVIRONMENT_NUMBER } from "../../src/routes/environments.route";

const dbMock = vi.hoisted(() => ({
    application: {
        findFirst: vi.fn(),
    },
    gitHubInstallation: {
        findUnique: vi.fn(),
    },
    previewkitEnvironment: {
        findUnique: vi.fn(),
    },
}));

vi.mock("@autonoma/db", () => ({ db: dbMock }));

const baseApplication = {
    id: "app_1",
    disabled: false,
    organizationId: "org_1",
    githubRepositoryId: 123,
    mainBranch: { name: "main" },
    mainBranchInfo: { githubRef: "refs/heads/main" },
};

const baseRepo = {
    id: 123,
    name: "web",
    fullName: "acme/web",
    defaultBranch: "main",
    private: true,
};

function buildApp(authCaller: AuthCaller = { kind: "user", userId: "user_1", organizationId: "org_1" }) {
    const previewPipeline = {
        deploy: vi.fn().mockResolvedValue(undefined),
    } as unknown as PreviewPipeline;
    const teardownPipeline = {} as TeardownPipeline;
    const gitProvider = {
        getRepository: vi.fn().mockResolvedValue(baseRepo),
        getBranchHead: vi.fn().mockResolvedValue("abcdef123456"),
    } as unknown as GitProvider;

    const app = new Hono<{ Variables: CallerAuthVariables }>();
    app.use("*", async (c, next) => {
        c.set("authCaller", authCaller);
        await next();
    });
    app.route(
        "/v1",
        createEnvironmentsRoute({
            previewPipeline,
            teardownPipeline,
            gitProvider,
            useTemporal: false,
        }),
    );

    return { app, previewPipeline, gitProvider };
}

describe("createEnvironmentsRoute main branch deploy", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMock.application.findFirst.mockResolvedValue(baseApplication);
        dbMock.gitHubInstallation.findUnique.mockResolvedValue({ installationId: 999, status: "active" });
    });

    it("deploys the linked Application main branch as the synthetic environment 0", async () => {
        const { app, previewPipeline, gitProvider } = buildApp();

        const response = await app.request("/v1/applications/app_1/0", { method: "POST" });
        const body = await response.json();

        expect(response.status).toBe(202);
        expect(body).toEqual({
            accepted: true,
            applicationId: "app_1",
            repoFullName: "acme/web",
            branch: "main",
            headSha: "abcdef123456",
            prNumber: MAIN_BRANCH_ENVIRONMENT_NUMBER,
            statusUrl: "/v1/environments/acme/web/0",
        });
        expect(dbMock.application.findFirst).toHaveBeenCalledWith({
            where: { id: "app_1", organizationId: "org_1" },
            select: {
                id: true,
                disabled: true,
                organizationId: true,
                githubRepositoryId: true,
                mainBranch: { select: { name: true } },
                mainBranchInfo: { select: { githubRef: true } },
            },
        });
        expect(gitProvider.getRepository).toHaveBeenCalledWith(999, 123);
        expect(gitProvider.getBranchHead).toHaveBeenCalledWith("acme/web", "main");
        expect(previewPipeline.deploy).toHaveBeenCalledWith(
            {
                action: "synchronize",
                prNumber: MAIN_BRANCH_ENVIRONMENT_NUMBER,
                repoFullName: "acme/web",
                organizationId: "org_1",
                githubRepositoryId: 123,
                headSha: "abcdef123456",
                headRef: "main",
                baseSha: "abcdef123456",
                baseRef: "main",
                cloneUrl: "https://github.com/acme/web.git",
            },
            { configRevisionId: undefined },
        );
    });

    it("trusts the Application id for service callers instead of adding user org scoping", async () => {
        const { app } = buildApp({ kind: "service" });

        const response = await app.request("/v1/applications/app_1/0", { method: "POST" });

        expect(response.status).toBe(202);
        expect(dbMock.application.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "app_1" } }));
    });

    it("rejects Applications that are not linked to GitHub", async () => {
        dbMock.application.findFirst.mockResolvedValue({ ...baseApplication, githubRepositoryId: null });
        const { app, previewPipeline, gitProvider } = buildApp();

        const response = await app.request("/v1/applications/app_1/0", { method: "POST" });
        const body = await response.json();

        expect(response.status).toBe(409);
        expect(body).toEqual({ error: "Application is not linked to a GitHub repository" });
        expect(gitProvider.getRepository).not.toHaveBeenCalled();
        expect(previewPipeline.deploy).not.toHaveBeenCalled();
    });

    it("returns 404 when the caller cannot access the Application", async () => {
        dbMock.application.findFirst.mockResolvedValue(null);
        const { app, previewPipeline } = buildApp();

        const response = await app.request("/v1/applications/app_1/0", { method: "POST" });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body).toEqual({ error: "Application not found" });
        expect(previewPipeline.deploy).not.toHaveBeenCalled();
    });
});
