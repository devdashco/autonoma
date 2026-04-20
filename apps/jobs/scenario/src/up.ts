import { db } from "@autonoma/db";
import { logger } from "@autonoma/logger";
import { EncryptionHelper, ScenarioManager } from "@autonoma/scenario";
import { scenarioUp } from "./scenario-up";
import { upEnv } from "./up-env";

const { SCENARIO_JOB_TYPE: type, ENTITY_ID: entityId } = upEnv;

logger.info("Starting scenario up", { type, entityId });

const encryption = new EncryptionHelper(upEnv.SCENARIO_ENCRYPTION_KEY);
const manager = new ScenarioManager(db, encryption);

try {
    await scenarioUp({ type, entityId }, { db, manager });
    process.exit(0);
} catch (error) {
    logger.error("Scenario up failed", error, { type, entityId });
    process.exit(1);
}
