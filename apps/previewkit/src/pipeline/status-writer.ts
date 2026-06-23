import type { BuildLogSink } from "@autonoma/logger/build-log-sink";
import { recordPhaseChanged } from "../db";
import type { Deployer } from "../deployer/deployer";
import { type Logger, logger } from "../logger";

/**
 * Writes a preview environment's status/phase transitions to the three sinks
 * that must stay in step: the environment row (via the deployer), the DB event
 * log, and the build-log sink. It also owns the supersede gate - `checkpoint`
 * aborts before writing if a newer commit cancelled this run, so a superseded
 * deploy stops advancing its phase the instant it loses the race.
 */
export class StatusWriter {
    private readonly logger: Logger;

    constructor(
        private readonly deployer: Deployer,
        private readonly logSink?: BuildLogSink,
    ) {
        this.logger = logger.child({ name: this.constructor.name });
    }

    /**
     * Advance to the next deploy phase, bailing first if a newer commit
     * superseded this run, so we stop sinking work into an environment the
     * successor now owns. Every long deploy step opens by advancing the phase,
     * so the cancellation check and the phase write are paired here. Writes that
     * finalize the environment (`ready`) keep their own explicit checks.
     */
    async checkpoint(
        signal: AbortSignal | undefined,
        repoFullName: string,
        prNumber: number,
        phase: string,
    ): Promise<void> {
        signal?.throwIfAborted();
        await this.updatePhase(repoFullName, prNumber, "deploying", phase);
    }

    async updatePhase(
        repoFullName: string,
        prNumber: number,
        status: "pending" | "building" | "deploying",
        phase: string,
    ): Promise<void> {
        await this.deployer.updateStatus(repoFullName, prNumber, { status, phase });
        const namespace = this.deployer.getNamespaceName(repoFullName, prNumber);
        await recordPhaseChanged({ namespace, status, phase }).catch((err: unknown) => {
            this.logger.error("Failed to record phase-changed event", err);
        });
        void this.logSink?.append(namespace, { kind: "phase", message: phase });
    }
}
