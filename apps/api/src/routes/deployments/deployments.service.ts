import type { PrismaClient } from "@autonoma/db";
import { NotFoundError } from "@autonoma/errors";
import { Service } from "../service";

export class DeploymentsService extends Service {
    constructor(private readonly db: PrismaClient) {
        super();
    }

    async listByPr(applicationId: string, prNumber: number, organizationId: string) {
        this.logger.info("Listing web deployments for PR", { applicationId, prNumber, organizationId });

        const branch = await this.db.branch.findFirst({
            where: {
                applicationId,
                organizationId,
                prInfo: { prNumber },
            },
            select: { id: true },
        });

        if (branch == null) throw new NotFoundError();

        const deployments = await this.db.branchDeployment.findMany({
            where: {
                organizationId,
                branchId: branch.id,
                webDeployment: { isNot: null },
            },
            select: {
                id: true,
                createdAt: true,
                updatedAt: true,
                branch: { select: { id: true, name: true } },
                webDeployment: {
                    select: { url: true, file: true, updatedAt: true },
                },
            },
            orderBy: { updatedAt: "desc" },
        });

        const visible = deployments.filter((d) => d.webDeployment != null && d.webDeployment.url !== "");

        return visible.map((d) => ({
            id: d.id,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            branch: d.branch,
            url: d.webDeployment!.url,
            file: d.webDeployment!.file,
        }));
    }
}
