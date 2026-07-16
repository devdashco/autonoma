import { ApplicationArchitecture, type PrismaClient, applyMigrations, createClient } from "@autonoma/db";
import { type IntegrationHarness, integrationTestSuite } from "@autonoma/integration-test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { expect } from "vitest";
import { reconcileAnalysis } from "../../src/activities/analysis/reconcile-analysis";

// reconcileAnalysis reads the `@autonoma/db` singleton (the global `db` proxy resolves to globalThis.prisma).
// Point it at this suite's container so the activity and the fixtures share one database.
declare global {
    // eslint-disable-next-line no-var
    var prisma: PrismaClient | undefined;
}

const POSTGRES_IMAGE = "postgres:17-alpine";

/** Monotonic counter for unique slugs across the suite (one shared container, no per-test truncation). */
let seq = 0;
const next = () => seq++;

class ReconcileHarness implements IntegrationHarness {
    constructor(
        public readonly db: PrismaClient,
        private readonly pg: StartedPostgreSqlContainer,
    ) {}

    static async create(): Promise<ReconcileHarness> {
        const pg = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
        applyMigrations(pg.getConnectionUri());
        const db = createClient(pg.getConnectionUri());
        globalThis.prisma = db;
        return new ReconcileHarness(db, pg);
    }

    async beforeAll() {}
    async afterAll() {
        await this.pg.stop();
    }
    async beforeEach() {}
    async afterEach() {}

    /** Seed a detached twin snapshot (+ its org/app/branch). Each case makes its own to avoid cross-leaking. */
    async seedTwin(headSha?: string): Promise<{ snapshotId: string; organizationId: string }> {
        const n = next();
        const org = await this.db.organization.create({ data: { name: `Org ${n}`, slug: `org-${n}` } });
        const app = await this.db.application.create({
            data: {
                name: `App ${n}`,
                slug: `app-${n}`,
                organizationId: org.id,
                architecture: ApplicationArchitecture.WEB,
            },
        });
        const branch = await this.db.branch.create({
            data: { name: `feature/${n}`, applicationId: app.id, organizationId: org.id },
        });
        const twin = await this.db.branchSnapshot.create({
            data: { branchId: branch.id, source: "GITHUB_PUSH", headSha },
        });
        return { snapshotId: twin.id, organizationId: org.id };
    }
}

integrationTestSuite({
    name: "reconcileAnalysis (shadow store)",
    createHarness: () => ReconcileHarness.create(),
    cases: (test) => {
        test("persists the shadow verdict, counts and findings, and files nothing user-facing", async ({ harness }) => {
            const { snapshotId, organizationId } = await harness.seedTwin("sha-mixed");

            const result = await reconcileAnalysis({
                snapshotId,
                mode: "shadow",
                candidates: [
                    { slug: "checkout", category: "passed", headline: "Checkout works" },
                    { slug: "login", category: "client_bug", headline: "Login 500s" },
                ],
            });

            expect(result.verdict).toBe("client_bug");
            expect(result.testCount).toBe(2);
            expect(result.clientBugCount).toBe(1);
            expect(result.filedCount).toBe(0);
            // No diffs job exists for this head sha, so the comparison degrades to "not found".
            expect(result.comparison.found).toBe(false);

            const row = await harness.db.analysisShadowRun.findUnique({ where: { snapshotId } });
            expect(row?.mode).toBe("shadow");
            expect(row?.verdict).toBe("client_bug");
            expect(row?.testCount).toBe(2);
            expect(row?.clientBugCount).toBe(1);
            expect(row?.findings).toHaveLength(2);
            expect(row?.deployed).toEqual({ found: false, deployedTestCount: 0 });

            // The shadow store is not the user-facing Bug model - a shadow run must never file one.
            expect(await harness.db.bug.count({ where: { organizationId } })).toBe(0);
        });

        test("resolves a `passed` verdict when no finding is a client bug", async ({ harness }) => {
            const { snapshotId } = await harness.seedTwin("sha-clean");

            const result = await reconcileAnalysis({
                snapshotId,
                mode: "shadow",
                candidates: [{ slug: "home", category: "passed", headline: "Home renders" }],
            });

            expect(result.verdict).toBe("passed");
            expect(result.clientBugCount).toBe(0);
            const row = await harness.db.analysisShadowRun.findUnique({ where: { snapshotId } });
            expect(row?.verdict).toBe("passed");
        });

        test("an empty target set yields a `passed` verdict with zero findings", async ({ harness }) => {
            const { snapshotId } = await harness.seedTwin();

            const result = await reconcileAnalysis({ snapshotId, mode: "shadow", candidates: [] });

            expect(result.verdict).toBe("passed");
            expect(result.testCount).toBe(0);
            const row = await harness.db.analysisShadowRun.findUnique({ where: { snapshotId } });
            expect(row?.testCount).toBe(0);
            expect(row?.findings).toEqual([]);
        });
    },
});
