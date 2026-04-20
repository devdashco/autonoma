import { db } from "@autonoma/db";
import { logger } from "@autonoma/logger";
import { EncryptionHelper, ScenarioManager } from "@autonoma/scenario";
import { downEnv } from "./down-env";
import { scenarioDown } from "./scenario-down";

const { SCENARIO_INSTANCE_ID: scenarioInstanceId } = downEnv;

logger.info("Starting scenario down", { scenarioInstanceId });

const encryption = new EncryptionHelper(downEnv.SCENARIO_ENCRYPTION_KEY);
const manager = new ScenarioManager(db, encryption);

try {
    await scenarioDown({ scenarioInstanceId }, { manager });
    process.exit(0);
} catch (error) {
    logger.error("Scenario down failed", error, { scenarioInstanceId });
    process.exit(1);
}
