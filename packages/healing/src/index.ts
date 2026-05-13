export { HealingAgent, type HealingAgentConfig } from "./healing-agent";
export type {
    HealingInput,
    HealingResult,
    FailureRecord,
    DiffsContext,
    TestCandidateInput,
    SnapshotInfo,
} from "./types";
export {
    healingActionSchema,
    type HealingAction,
    type UpdatePlanAction,
    type AddTestAction,
    type ReportBugAction,
    type ReportEngineLimitationAction,
    type RemoveTestAction,
    type HealingEvidenceItem,
} from "./actions";
export {
    BugMatcher,
    buildFindMatchingBugsTool,
    type FindMatchingBugsInput,
    type FindMatchingBugsResult,
} from "./tools/find-matching-bugs";
