import { logger } from "@autonoma/logger";
import { describe, expect, it } from "vitest";
import { webmToGif } from "./webm-to-gif";

const log = logger.child({ name: "webmToGif.test" });

describe("webmToGif", () => {
    it("returns undefined for input ffmpeg cannot decode (degrades, never throws)", async () => {
        const result = await webmToGif(new Uint8Array([0, 1, 2, 3, 4, 5]), log);
        expect(result).toBeUndefined();
    }, 30_000);
});
