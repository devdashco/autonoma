/**
 * Pull a one-line summary from a test plan's YAML frontmatter (description + intent) - the progressive-disclosure
 * label used wherever a catalog of tests is shown to a model (the selector's catalog, the merge reconciler's
 * main-suite view). Returns a sentinel when there is no plan or no usable frontmatter.
 */
export function planSummary(prompt: string | undefined): string {
    if (prompt == null) return "(no plan)";
    const description = prompt.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1];
    const intent = prompt.match(/^intent:\s*["']?(.+?)["']?\s*$/m)?.[1];
    const summary = [description, intent].filter((part) => part != null && part !== "").join(" - ");
    return summary !== "" ? summary : "(no description)";
}
