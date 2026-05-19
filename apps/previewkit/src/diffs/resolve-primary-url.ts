import type { AppConfig } from "../config/schema";

export function resolvePrimaryUrl(apps: AppConfig[], urls: Record<string, string>): string | undefined {
    const primaryApp = apps.find((a) => a.primary === true) ?? apps[0];
    if (primaryApp == null) return undefined;
    return urls[primaryApp.name];
}
