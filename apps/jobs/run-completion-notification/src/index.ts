import { logger } from "@autonoma/logger";
import { handleGenerationExit } from "./handlers/generation-exit";
import { handleMarkGenerationFailed } from "./handlers/mark-generation-failed";

const VALID_COMMANDS = ["generation-exit", "mark-failed"] as const;
type Command = (typeof VALID_COMMANDS)[number];

const args = process.argv.slice(2);
const command = args[0] as Command | undefined;

if (command == null || !VALID_COMMANDS.includes(command)) {
    console.error("Usage: run-completion-notification <generation-exit|mark-failed> <generationId>");
    process.exit(1);
}

const generationIdArg = args[1];
if (generationIdArg == null) {
    console.error("Usage: run-completion-notification <generation-exit|mark-failed> <generationId>");
    process.exit(1);
}
const generationId: string = generationIdArg;

logger.info("Starting run completion notification job", { command, generationId });

try {
    if (command === "mark-failed") {
        await handleMarkGenerationFailed(generationId);
    } else {
        await handleGenerationExit(generationId);
    }
    process.exit(0);
} catch (error) {
    logger.error("Notification job failed", error, { command, generationId });
    process.exit(1);
}
