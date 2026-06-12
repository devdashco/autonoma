/**
 * CLI entry for the Healing capture command.
 *
 * Usage: tsx evals/capture/capture-healing-cli.ts <iterationId> [--name <case-name>] [--force]
 *
 * Run via the `capture:healing` package script so env is loaded from the repo
 * `.env`. Required env: DATABASE_URL + the GITHUB_APP_* credentials.
 */

import { parseArgs } from "node:util";
import { logger as rootLogger } from "@autonoma/logger";
import { captureHealing } from "./capture-healing";

async function main(): Promise<void> {
    const logger = rootLogger.child({ name: "capture-healing-cli" });

    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            name: { type: "string" },
            force: { type: "boolean", default: false },
        },
    });

    const [iterationId] = positionals;
    if (iterationId == null) {
        throw new Error("Missing <iterationId>. Usage: capture:healing <iterationId> [--name <case-name>] [--force]");
    }

    const params: Parameters<typeof captureHealing>[0] = { iterationId, force: values.force, name: values.name };

    const caseDir = await captureHealing(params);

    logger.info("Capture complete", { extra: { caseDir } });
    process.stdout.write(`Captured healing case to ${caseDir}\nEdit expected.md and set skip: false to enable it.\n`);
}

try {
    await main();
} catch (err) {
    console.error(err);
    rootLogger.child({ name: "capture-healing-cli" }).error("Capture failed", err);
    process.exitCode = 1;
}
