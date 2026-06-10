import { logger as rootLogger } from "@autonoma/logger";
import Redis from "ioredis";

const logger = rootLogger.child({ name: "redis" });

export interface RedisParams {
    url: string;
    connectTimeout?: number;
}

/**
 * Connects an ioredis client used by the BuildLogSpool to publish live build
 * logs. Mirrors the autonoma API's connector so both services share connection
 * semantics (lazy connect + error logging).
 */
export async function connectRedis({ url, connectTimeout = 10000 }: RedisParams): Promise<Redis> {
    logger.info("Connecting to Redis", { url });

    try {
        const redisClient = new Redis(url, { connectTimeout, lazyConnect: true });

        redisClient.on("error", (err) => logger.error("Redis connection error", err));

        await redisClient.connect();

        return redisClient;
    } catch (err) {
        logger.error("Failed to connect to Redis", err);
        throw err;
    }
}
