import type { PrismaClient } from "@autonoma/db";
import { type ArtifactStatus, type ArtifactStatusItem, FileDataSchema } from "@autonoma/types";
import { Service } from "../service";

export class ApplicationSetupsService extends Service {
    constructor(private readonly db: PrismaClient) {
        super();
    }

    async getLatest(organizationId: string, applicationId: string) {
        return await this.db.applicationSetup.findFirst({
            where: { applicationId, organizationId },
            orderBy: { createdAt: "desc" },
            include: {
                events: { orderBy: { createdAt: "asc" } },
            },
        });
    }

    async getById(setupId: string, organizationId: string) {
        return await this.db.applicationSetup.findFirst({
            where: { id: setupId, organizationId },
            include: {
                events: { orderBy: { createdAt: "asc" } },
            },
        });
    }

    /**
     * Per-artifact upload progress for the onboarding "Setup" step. The UI polls
     * this every 5s while the planner CLI runs and auto-advances once `complete`
     * flips (the CLI marks the setup `completed` after its final upload).
     */
    async artifactStatus(organizationId: string, applicationId: string): Promise<ArtifactStatus> {
        this.logger.info("Fetching artifact status", { extra: { applicationId, organizationId } });

        const setup = await this.db.applicationSetup.findFirst({
            where: { applicationId, organizationId },
            orderBy: { createdAt: "desc" },
            select: {
                status: true,
                events: { where: { type: "file.created" }, select: { data: true } },
            },
        });

        const filePaths = (setup?.events ?? []).flatMap((event) => {
            const parsed = FileDataSchema.safeParse(event.data);
            return parsed.success ? [parsed.data.filePath] : [];
        });

        const testCount = filePaths.filter((path) => path.startsWith("autonoma/qa-tests/")).length;
        const hasKb = filePaths.includes("AUTONOMA.md");
        const hasScenarios = filePaths.includes("scenarios.md");

        const scenarioCount = await this.db.scenario.count({
            where: { applicationId, activeRecipeVersionId: { not: null } },
        });

        const artifacts: ArtifactStatusItem[] = [
            {
                key: "recipe",
                received: scenarioCount > 0,
                meta: scenarioCount > 0 ? `${scenarioCount} scenario${scenarioCount === 1 ? "" : "s"}` : undefined,
            },
            {
                key: "tests",
                received: testCount > 0,
                meta: testCount > 0 ? `${testCount} file${testCount === 1 ? "" : "s"}` : undefined,
            },
            { key: "kb", received: hasKb },
            { key: "scenarios", received: hasScenarios },
        ];

        return { complete: setup?.status === "completed", artifacts };
    }
}
