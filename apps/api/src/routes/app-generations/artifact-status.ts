import type { PrismaClient } from "@autonoma/db";
import { type ArtifactStatus, type ArtifactStatusItem, FileDataSchema } from "@autonoma/types";

/**
 * Per-artifact upload progress plus the canonical `complete` flag, shared by the
 * onboarding Setup status endpoint and the onboarding state's `artifactsUploaded`
 * so the step-2 header, the per-item checks, and the bottom banner stay in sync.
 *
 * Status is aggregated across ALL of the app's setups, not just the newest one, so
 * an empty or stale setup can never shadow a completed CLI run and blank the checks
 * on refresh. `complete` is true once ANY setup was marked `completed`, and an
 * artifact counts as received once ANY setup produced it. The recipe is app-scoped
 * already (derived from active scenario recipe versions, not from a specific setup).
 */
export async function computeArtifactStatus(
    db: PrismaClient,
    applicationId: string,
    organizationId?: string,
): Promise<ArtifactStatus> {
    // Push every filter into the DB (scoped to the app's setups via the relation, and
    // to specific file paths via a JSON filter) instead of pulling all setups + their
    // events into memory. Each probe is an existence check or a targeted fetch; the
    // recipe is a plain count of active scenario recipe versions.
    const fileEventWhere = { setup: { applicationId, organizationId }, type: "file.created" as const };
    const [completedSetup, kbEvent, scenariosEvent, testEvents, scenarioCount] = await Promise.all([
        db.applicationSetup.findFirst({
            where: { applicationId, organizationId, status: "completed" },
            select: { id: true },
        }),
        db.applicationSetupEvent.findFirst({
            where: { ...fileEventWhere, data: { path: ["filePath"], equals: "AUTONOMA.md" } },
            select: { id: true },
        }),
        db.applicationSetupEvent.findFirst({
            where: { ...fileEventWhere, data: { path: ["filePath"], equals: "scenarios.md" } },
            select: { id: true },
        }),
        db.applicationSetupEvent.findMany({
            where: { ...fileEventWhere, data: { path: ["filePath"], string_starts_with: "autonoma/qa-tests/" } },
            select: { data: true },
        }),
        db.scenario.count({
            where: { applicationId, organizationId, activeRecipeVersionId: { not: null } },
        }),
    ]);

    const complete = completedSetup != null;
    const hasKb = kbEvent != null;
    const hasScenarios = scenariosEvent != null;
    // Dedupe across setups: the same file can be recorded under more than one setup
    // (e.g. a re-upload targeting a fresh generation id), so count distinct paths.
    const testCount = new Set(
        testEvents.flatMap((event) => {
            const parsed = FileDataSchema.safeParse(event.data);
            return parsed.success ? [parsed.data.filePath] : [];
        }),
    ).size;

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

    // The step is only done when the run completed AND every artifact landed - a run
    // can finish (setup completed) with the recipe (or any artifact) still missing.
    const stepComplete = complete && artifacts.every((artifact) => artifact.received);

    return { complete, stepComplete, artifacts };
}
