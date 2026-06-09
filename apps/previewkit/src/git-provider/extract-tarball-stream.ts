import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract as extractTar } from "tar-fs";
import { logger as rootLogger } from "../logger";

/**
 * Streams a gzipped repo tarball straight into `targetDir`, stripping the
 * single top-level directory GitHub wraps every archive in (e.g.
 * `owner-repo-<sha>/`) so files land directly under `targetDir`.
 *
 * Streaming - rather than first buffering the whole gzip into memory - keeps
 * previewkit's heap flat regardless of repo size. That matters under load:
 * many large monorepo deploys can run at once, and buffering each full archive
 * was a direct contributor to the pod's OOM kills. The extracted tree still
 * lands on disk exactly as before; only the in-memory gzip buffer is removed.
 */
export async function extractTarballStream(gzipped: Readable, targetDir: string): Promise<void> {
    const logger = rootLogger.child({ name: "extractTarballStream" });
    logger.info("Extracting gzipped tarball stream", { targetDir });

    const extractor = extractTar(targetDir, {
        map: (header) => {
            const firstSlash = header.name.indexOf("/");
            if (firstSlash >= 0) {
                header.name = header.name.slice(firstSlash + 1);
            }
            return header;
        },
    });

    await pipeline(gzipped, createGunzip(), extractor);

    logger.info("Tarball stream extracted", { targetDir });
}
