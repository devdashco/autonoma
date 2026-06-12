import { db } from "@autonoma/db";
import { logger } from "@autonoma/logger";

const STUCK_STATUSES = ["pending", "queued"] as const;

export async function handleMarkGenerationFailed(generationId: string): Promise<void> {
    const log = logger.child({ name: "handleMarkGenerationFailed", generationId });

    const generation = await db.testGeneration.findUnique({
        where: { id: generationId },
        select: { status: true },
    });

    if (generation == null) {
        log.warn("Generation not found, skipping");
        return;
    }

    const isStuck = (STUCK_STATUSES as readonly string[]).includes(generation.status);
    if (!isStuck) {
        log.info("Generation is not in a stuck state, skipping", { status: generation.status });
        return;
    }

    log.info("Marking generation as failed due to scenario setup failure", { currentStatus: generation.status });

    // No unwrapped cause is available in this reaper, so the message is static
    // guidance; the failure panel supplies the webhook-config hint regardless.
    await db.testGeneration.update({
        where: { id: generationId },
        data: {
            status: "failed",
            failure: { kind: "scenario_setup", message: "Scenario setup failed before the generation could start." },
        },
    });

    log.info("Generation marked as failed");
}
