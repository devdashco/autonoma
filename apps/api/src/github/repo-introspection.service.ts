import type { GitTree } from "@autonoma/github";
import { Service } from "../routes/service";
import type { RepoReader } from "./repo-reader";

/**
 * Read-only repository tree access for the PreviewKit config preflight: returns
 * the repo's file tree at its default-branch head so the config service can warn
 * on paths / Dockerfiles that do not exist. Any GitHub failure degrades to
 * `undefined` so preflight never blocks.
 */
export class RepoIntrospectionService extends Service {
    constructor(private readonly repoReader: RepoReader) {
        super();
    }

    /**
     * The repo's file tree at its default-branch head, for config preflight checks.
     * Returns undefined when GitHub is unavailable - preflight must never block.
     */
    async getRepoTree(
        organizationId: string,
        applicationId: string,
        githubRepositoryId?: number,
    ): Promise<GitTree | undefined> {
        try {
            const context = await this.repoReader.resolveRepoContext(organizationId, applicationId, githubRepositoryId);
            return await this.repoReader.getCachedTree(context);
        } catch (err) {
            this.logger.warn("Repo tree unavailable", { organizationId, applicationId, githubRepositoryId, err });
            return undefined;
        }
    }
}
