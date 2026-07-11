/**
 * The sub-steps of the PreviewKit config step. Shared by the config page (its
 * active-step state), the onboarding route (search-param validation), and the
 * sidebar (which renders these as informative sub-navigation under "Config
 * previews"). Kept here, not in the config page, so the sidebar can import the
 * list without pulling in the whole page.
 */
export const CONFIG_SUB_STEPS = [
    { id: "apps", label: "Apps", group: "required" },
    { id: "database", label: "Database", group: "required" },
    { id: "variables", label: "Variables", group: "required" },
    { id: "services", label: "Extra services", group: "optional" },
    { id: "hooks", label: "Lifecycle hooks", group: "optional" },
    { id: "review", label: "Finish", group: "terminal" },
] as const;

export type ConfigStepId = (typeof CONFIG_SUB_STEPS)[number]["id"];

const CONFIG_STEP_ID_SET = new Set<string>(CONFIG_SUB_STEPS.map((step) => step.id));

export function isConfigStepId(value: string): value is ConfigStepId {
    return CONFIG_STEP_ID_SET.has(value);
}
