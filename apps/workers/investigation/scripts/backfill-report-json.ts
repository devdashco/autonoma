import { db } from "@autonoma/db";
import { parseReportMarkdown } from "@autonoma/investigation";
import { getStorage } from "../src/services";

// One-off: backfill the structured <snapshot>.json next to every investigation report that only has the
// markdown (reports written before the worker emitted JSON). Downloads each .md, parses it into the UI
// contract, and uploads the .json so the in-app "View investigation" page works on historical reports too.
// Best-effort per row: a single bad report never aborts the run. Usage:
//   tsx --env-file=<env> scripts/backfill-report-json.ts [--overwrite]

async function main(): Promise<void> {
    const overwrite = process.argv.includes("--overwrite");
    const storage = getStorage();
    const reports = await db.investigationReport.findMany({ select: { snapshotId: true, s3Key: true } });
    console.log(`backfilling ${reports.length} reports (overwrite=${overwrite})`);

    let written = 0;
    let skipped = 0;
    let failed = 0;
    for (const report of reports) {
        const jsonKey = report.s3Key.replace(/\.md$/, ".json");
        try {
            if (!overwrite) {
                const exists = await storage
                    .download(jsonKey)
                    .then(() => true)
                    .catch(() => false);
                if (exists) {
                    skipped += 1;
                    continue;
                }
            }
            const markdown = (await storage.download(report.s3Key)).toString("utf8");
            const data = parseReportMarkdown(markdown);
            await storage.upload(jsonKey, Buffer.from(JSON.stringify(data), "utf8"));
            written += 1;
        } catch (error) {
            failed += 1;
            console.warn(`  failed ${report.snapshotId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    console.log(`done: written=${written}, skipped=${skipped}, failed=${failed}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
