import type { GeneralActivities } from "@autonoma/workflow/activities";

export { scenarioUp, scenarioDown } from "./scenario";
export { reviewGeneration, reviewReplay } from "./review";
export { createIssueFromGenerationReview, createIssueFromRunReview } from "./issue";
export { assignGenerationResults } from "./assign-generation-results";
export { notifyGenerationExit } from "./notify-generation-exit";
export { markGenerationFailed } from "./mark-generation-failed";
export { markRunFailed } from "./mark-run-failed";

import { assignGenerationResults } from "./assign-generation-results";
import { createIssueFromGenerationReview, createIssueFromRunReview } from "./issue";
import { markGenerationFailed } from "./mark-generation-failed";
import { markRunFailed } from "./mark-run-failed";
import { notifyGenerationExit } from "./notify-generation-exit";
import { reviewGeneration, reviewReplay } from "./review";
import { scenarioDown, scenarioUp } from "./scenario";

// Compile-time check: ensure exported activities match the GeneralActivities contract.
({
    scenarioUp,
    scenarioDown,
    reviewGeneration,
    reviewReplay,
    createIssueFromGenerationReview,
    createIssueFromRunReview,
    assignGenerationResults,
    notifyGenerationExit,
    markGenerationFailed,
    markRunFailed,
}) satisfies GeneralActivities;
