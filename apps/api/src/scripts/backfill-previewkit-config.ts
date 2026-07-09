import { db, Prisma } from "@autonoma/db";
import { logger as rootLogger } from "@autonoma/logger";

/**
 * Expand-phase backfill for the latest-only preview-config cutover.
 *
 * Copies each Application's ACTIVE config revision into the new
 * `previewkit_config` table (one row per Application). This replaces the
 * INSERT...SELECT that used to live inside the DDL migration: keeping the copy
 * in a standalone, dry-runnable script decouples it from the destructive
 * contract migration (which drops `previewkit_config_revision`,
 * `application.active_config_revision_id`, and
 * `previewkit_environment.config_revision_id`) so it can be run and verified per
 * environment during a quiet window before anything is dropped.
 *
 * Idempotent and non-destructive: it only writes a `previewkit_config` row when
 * one is absent for the Application (the scan filters those out, and the write is
 * an upsert with a no-op `update`). An Application that already has a config row
 * (a prior run, or a fresh save written by the new code) is left untouched, so
 * the backfill never clobbers newer data and is safe to re-run.
 *
 * Applications with no active revision get no row - the same "previews skipped"
 * opt-out as before. Their count is logged so the operator can see coverage.
 *
 * Dry-run by default; pass `--apply` to write.
 *
 * Run: pnpm --filter @autonoma/api backfill:previewkit-config [-- --apply]
 *
 * Rollout order (per environment):
 *   1. apply the `previewkit_config_add` migration (creates the empty table),
 *   2. run this script with `--apply` and verify the counts,
 *   3. once every environment is backfilled, ship the contract migration that
 *      drops the legacy revision model.
 */

const logger = rootLogger.child({ name: "backfill-previewkit-config" });

// Page size for the cursor scan. Bounds peak memory: each page holds at most
// this many Applications and their (potentially large) active-revision config
// documents, never the whole table at once.
const BATCH_SIZE = 500;

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    logger.info(apply ? "Running backfill (APPLY)" : "Running backfill (dry-run)");

    let created = 0;
    let mismatchedRevision = 0;
    let scanned = 0;
    let cursor: string | undefined;

    // Cursor-paginated scan of only the Applications that still need a config:
    // an active revision but no `previewkit_config` row yet. The relation filter
    // (`previewkitConfig: { is: null }`) does the existence check in the DB, and
    // the `activeConfigRevision` relation include pulls the source document in
    // the same query, so there is no per-app existence or revision lookup (no
    // N+1) and never a full-table load. Scanning by ascending id keeps forward
    // progress stable even as `--apply` inserts remove rows from the filter
    // (inserted rows have id <= cursor, so they fall outside `id > cursor`).
    for (;;) {
        const batch = await db.application.findMany({
            where: { activeConfigRevisionId: { not: null }, previewkitConfig: { is: null } },
            select: {
                id: true,
                activeConfigRevision: {
                    select: { applicationId: true, document: true, dependencyDocuments: true, createdAt: true },
                },
            },
            orderBy: { id: "asc" },
            take: BATCH_SIZE,
            ...(cursor != null ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (batch.length === 0) break;
        cursor = batch[batch.length - 1]?.id;
        scanned += batch.length;

        for (const app of batch) {
            const revision = app.activeConfigRevision;
            // The active pointer must reference THIS Application's revision
            // (mirrors the deploy-time resolver's guard). The SetNull FK means it
            // is never dangling, but it could point at another app's revision.
            if (revision == null || revision.applicationId !== app.id) {
                mismatchedRevision += 1;
                logger.warn("Active revision missing or not owned by application; skipping", {
                    applicationId: app.id,
                });
                continue;
            }

            if (!apply) {
                created += 1;
                continue;
            }

            // upsert (not create) so a row written between the scan and this
            // write - a concurrent save by the new code path - is a no-op instead
            // of a unique-constraint violation that aborts the run. `update: {}`
            // keeps it non-clobbering: newer data always wins.
            await db.previewkitConfig.upsert({
                where: { applicationId: app.id },
                create: {
                    applicationId: app.id,
                    document: revision.document ?? Prisma.JsonNull,
                    dependencyDocuments: revision.dependencyDocuments ?? Prisma.DbNull,
                    createdAt: revision.createdAt,
                },
                update: {},
            });
            created += 1;
        }
    }

    // Informational: Applications that have revision history but no active
    // pointer are intentionally NOT backfilled (previews were already opted out);
    // surface the count so the operator can confirm that is expected.
    const appsWithRevisionsButNoActive = await db.application.count({
        where: { activeConfigRevisionId: null, previewkitConfigRevisions: { some: {} } },
    });

    logger.info("Backfill complete", {
        apply,
        scanned,
        created,
        mismatchedRevision,
        appsWithRevisionsButNoActive,
    });
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        logger.error("Backfill failed", err);
        process.exit(1);
    });
