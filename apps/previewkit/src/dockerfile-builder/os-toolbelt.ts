import { PREVIEWKIT_TOOLBELT, type PreviewkitRuntimeBase } from "@autonoma/types";

/**
 * OS package-manager strategies: how each base-image package manager installs a
 * set of packages as one cached `RUN` layer. This is the only place that knows
 * the apt syntax - adding a new base OS (apk, yum, dnf, ...) is one entry here,
 * not a branch scattered through the generator.
 */
const OS_TOOLBELT_INSTALL: Record<PreviewkitRuntimeBase, (packages: string) => string> = {
    apt: (packages) =>
        `RUN apt-get update && apt-get install -y --no-install-recommends ${packages} && rm -rf /var/lib/apt/lists/*`,
};

/** The toolbelt install `RUN` line for a base image's package manager (packages from the shared catalog). */
export function toolbeltInstall(base: PreviewkitRuntimeBase): string {
    return OS_TOOLBELT_INSTALL[base](PREVIEWKIT_TOOLBELT[base].packages.join(" "));
}
