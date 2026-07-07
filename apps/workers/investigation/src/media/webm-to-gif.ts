import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Logger } from "@autonoma/logger";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

const execFileAsync = promisify(execFile);

// Speed the footage up so the whole run is watchable in a short, scannable clip, then keep it small
// enough for GitHub to render inline: downscale, drop the frame rate, and palette-optimize. The clip
// spans the entire run (no duration cap) - at 8x speed and FPS=8 the frame count is roughly the run
// length in seconds, so it stays a few MB for typical runs.
const SPEED_MULTIPLIER = 8;
const FPS = 8;
const WIDTH = 1280;

/**
 * Turn a run recording buffer (WebM/MP4) into a short, size-bounded animated GIF via ffmpeg, using the
 * standard 2-pass palettegen/paletteuse for acceptable quality at small size. Best-effort: returns
 * undefined on any failure so the caller falls back to a static poster (never fails the run).
 */
export async function webmToGif(video: Uint8Array, logger: Logger): Promise<Buffer | undefined> {
    let dir: string | undefined;
    try {
        dir = await mkdtemp(path.join(os.tmpdir(), "clip-"));
        const input = path.join(dir, "input");
        const palette = path.join(dir, "palette.png");
        const output = path.join(dir, "clip.gif");
        await writeFile(input, video);

        // setpts must precede fps so timestamps are compressed first, then resampled to FPS.
        const filters = `setpts=PTS/${SPEED_MULTIPLIER},fps=${FPS},scale=${WIDTH}:-1:flags=lanczos`;
        await execFileAsync(ffmpeg.path, ["-y", "-i", input, "-vf", `${filters},palettegen`, palette]);
        await execFileAsync(ffmpeg.path, [
            "-y",
            "-i",
            input,
            "-i",
            palette,
            "-lavfi",
            `${filters}[x];[x][1:v]paletteuse`,
            "-loop",
            "0",
            output,
        ]);

        return await readFile(output);
    } catch (error) {
        logger.warn("Could not generate GIF clip from run video; falling back to poster", { err: error });
        return undefined;
    } finally {
        if (dir != null) {
            await rm(dir, { recursive: true, force: true }).catch((err) => {
                logger.warn("Could not clean up GIF temp dir", { extra: { dir }, err });
            });
        }
    }
}
