import { z } from "zod";

export const GitHubInstallationStatusSchema = z.enum(["active", "suspended", "deleted"]);
export type GitHubInstallationStatus = z.infer<typeof GitHubInstallationStatusSchema>;

export const GithubInstallationSchema = z.object({
    id: z.string(),
    installationId: z.number(),
    organizationId: z.string(),
    accountLogin: z.string(),
    accountId: z.number(),
    accountType: z.string(),
    status: GitHubInstallationStatusSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
});
export type GithubInstallation = z.infer<typeof GithubInstallationSchema>;
