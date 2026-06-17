import { join } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts", "test/**/*.test.ts"],
        exclude: ["**/dist/**", "**/node_modules/**"],
        // Loads DATABASE_URL etc. so the `@autonoma/db` env validation passes at
        // import; the integration tests then point the global db at a container.
        env: { ...config({ path: join(__dirname, "../../../.env") }).parsed },
        watch: false,
    },
});
