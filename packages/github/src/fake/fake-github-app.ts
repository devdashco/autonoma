import type { GitHubApp } from "../github-app";
import type { GitHubInstallationClient } from "../github-installation-client";
import { FakeGitHubInstallationClient } from "./fake-github-installation-client";

export class FakeGitHubApp implements GitHubApp {
    readonly slug: string = "fake-app";
    readonly defaultClient: FakeGitHubInstallationClient;
    readonly deletedInstallations: number[] = [];

    private clients: Map<number, FakeGitHubInstallationClient> = new Map();

    constructor(defaultClient?: FakeGitHubInstallationClient) {
        this.defaultClient = defaultClient ?? new FakeGitHubInstallationClient();
    }

    async getInstallationClient(installationId: number): Promise<GitHubInstallationClient> {
        return this.clients.get(installationId) ?? this.defaultClient;
    }

    async deleteInstallation(installationId: number): Promise<void> {
        this.deletedInstallations.push(installationId);
    }

    async verifyWebhook(_body: string, _signature: string): Promise<boolean> {
        return true;
    }

    setClient(installationId: number, client: FakeGitHubInstallationClient): void {
        this.clients.set(installationId, client);
    }
}
