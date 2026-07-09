import { integrationTestSuite } from "@autonoma/integration-test";
import { expect } from "vitest";
import { loadConfig } from "../../src/config/load-config";
import { resolveConfig } from "../../src/config/resolver";
import { PreviewkitTestHarness } from "./harness";

async function createApplication(harness: PreviewkitTestHarness, slug = "web"): Promise<string> {
    const { organizationId } = await harness.createOrganization();
    const application = await harness.db.application.create({
        data: { name: slug, slug, architecture: "WEB", organizationId },
    });
    return application.id;
}

// Seeds an application's config row, standing in for the authoring API in
// apps/api (previewkit itself only reads configs, never writes them).
async function seedConfig(
    harness: PreviewkitTestHarness,
    applicationId: string,
    document: object,
    dependencyDocuments?: object[],
): Promise<void> {
    await harness.db.previewkitConfig.create({
        data: { applicationId, document, dependencyDocuments },
    });
}

const baseConfig = resolveConfig({
    document: { version: 1, domain: "base.example.com", apps: [{ name: "web", port: 3000 }] },
});

integrationTestSuite({
    name: "previewkit config loading",
    createHarness: () => PreviewkitTestHarness.create(),
    cases: (test) => {
        test("loadConfig returns undefined when the application has no config", async ({ harness }) => {
            const applicationId = await createApplication(harness);

            const loaded = await loadConfig(applicationId);

            expect(loaded).toBeUndefined();
        });

        test("loadConfig resolves the stored document into a validated config", async ({ harness }) => {
            const applicationId = await createApplication(harness);
            await seedConfig(harness, applicationId, baseConfig);

            const loaded = await loadConfig(applicationId);

            expect(loaded).toBeDefined();
            expect(loaded!.config.apps[0]!.name).toBe("web");
            expect(loaded!.config.domain).toBe("base.example.com");
            expect(loaded!.dependencyConfigs).toEqual([]);
        });

        test("loadConfig honors per-app/service resource overrides from a stored config", async ({ harness }) => {
            const applicationId = await createApplication(harness);
            // A stored config is a trusted, platform-authored source, so its
            // `resources` overrides are honored - unlike untrusted client input,
            // which is ignored.
            await seedConfig(harness, applicationId, {
                version: 1,
                apps: [{ name: "web", port: 3000, resources: { cpu: "2", memory: "4Gi" } }],
                services: [{ name: "db", recipe: "postgres", resources: { cpu: "1", memory: "2Gi" } }],
            });

            const loaded = await loadConfig(applicationId);

            expect(loaded!.config.apps[0]!.resources).toEqual({ cpu: "2", memoryRequest: "4Gi", memoryLimit: "4Gi" });
            expect(loaded!.config.services[0]!.resources).toEqual({
                cpu: "1",
                memoryRequest: "2Gi",
                memoryLimit: "2Gi",
            });
        });

        test("loadConfig resolves dependency configs stored on the primary config", async ({ harness }) => {
            const applicationId = await createApplication(harness);
            const dependencyDocument = {
                version: 1,
                apps: [{ name: "api", port: 4000 }],
            };
            await seedConfig(harness, applicationId, baseConfig, [{ repo: "acme/api", document: dependencyDocument }]);

            const loaded = await loadConfig(applicationId);

            expect(loaded!.dependencyConfigs).toHaveLength(1);
            expect(loaded!.dependencyConfigs[0]!.repo).toBe("acme/api");
            expect(loaded!.dependencyConfigs[0]!.config.apps[0]!.name).toBe("api");
        });
    },
});
