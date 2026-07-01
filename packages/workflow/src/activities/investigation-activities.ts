import type { WorkflowArchitecture } from "../types";

/** A shadow test the investigation will run + classify (one shadow TestGeneration already created for it). */
export interface InvestigationSelectedTest {
    slug: string;
    reason: string;
    testGenerationId: string;
    scenarioId?: string;
    architecture: WorkflowArchitecture;
}

export interface SelectInvestigationTestsInput {
    snapshotId: string;
}

/** A NEW test the agent proposes for brand-new functionality (a full E2E plan, following the guardrails). */
export interface SuggestedNewTest {
    name: string;
    /** A one-line falsifiable behavioral claim - the test case's immutable description when persisted. */
    description: string;
    instruction: string;
    reasoning: string;
    /** Validation outcome once the proposed test has been run (Objective 2c); absent until then. */
    validation?: TestValidationResult;
}

/** An existing test the agent recommends quarantining because the PR removed the functionality it covers. */
export interface QuarantineRecommendation {
    slug: string;
    reason: string;
}

/** The outcome of running a proposed/modified plan through the validate->edit->retry loop. */
export interface TestValidationResult {
    passed: boolean;
    iterations: number;
    /** The final plan after any edits (the version that passed, or the last attempt). */
    finalPlan: string;
    /** Why it could not be made to pass, if it didn't. */
    failureReason?: string;
}

export interface SelectInvestigationTestsOutput {
    appSlug: string;
    prNumber: number;
    tests: InvestigationSelectedTest[];
    suggested: SuggestedNewTest[];
    quarantine: QuarantineRecommendation[];
}

/** A serializable verdict (RunVerdict from @autonoma/investigation is structurally assignable to this). */
export interface InvestigationEvidence {
    source: string;
    detail: string;
    file?: string;
    lines?: string;
    snippet?: string;
}
export interface InvestigationVerdict {
    category: string;
    isClientBug: boolean;
    ran: boolean;
    confidence: string;
    planFidelity?: string;
    headline: string;
    falsePositiveRisk: string;
    whatHappened: string;
    rootCause: string;
    remediation: string;
    suggestedTestUpdate?: string;
    /** App problems visible in the video independent of the test's pass/fail; absent if the app looked healthy. */
    observedAppIssues?: string;
    evidence: InvestigationEvidence[];
}

/** One classified shadow run, carried from the classify activity to the report activity. */
export interface InvestigationTestResult {
    slug: string;
    /** The test's current plan (for rendering the suggested update as a diff). */
    plan: string;
    runSuccess: boolean;
    stepCount: number;
    /** The step-by-step run trace (interaction + status + per-step error) - the run agent's observation log. */
    runSteps?: string[];
    verdict?: InvestigationVerdict;
    error?: string;
    videoUrl?: string;
    finalScreenshotUrl?: string;
    /** Validation outcome if the suggested modification was run through the validate->edit->retry loop. */
    modificationValidation?: TestValidationResult;
}

export interface ClassifyInvestigationRunInput {
    snapshotId: string;
    slug: string;
    reason: string;
    testGenerationId: string;
}

// --- Validate->edit->retry loop (Objective 2c). Each iteration creates a shadow generation for a candidate
// plan, the workflow runs it on the web worker, then checks the outcome and (if failed) gets a revised plan.

export interface CreateValidationGenerationInput {
    snapshotId: string;
    /** The candidate plan to validate this iteration. */
    plan: string;
    /** The existing test being MODIFIED (a dangling draft plan is attached to it). Absent for a NEW test. */
    baseSlug?: string;
}

export interface CreateValidationGenerationOutput {
    /** A shadow generation to run + classify, or undefined if one couldn't be prepared. */
    testGenerationId?: string;
    scenarioId?: string;
    /** The slug to classify the run under (the existing slug for a modification). */
    slug?: string;
    /** Why no generation was prepared (e.g. new-test validation needs the shadow-test marker). */
    skippedReason?: string;
}

export interface WriteInvestigationReportInput {
    snapshotId: string;
    results: InvestigationTestResult[];
    suggested: SuggestedNewTest[];
    quarantine: QuarantineRecommendation[];
}

export interface WriteInvestigationReportOutput {
    reportUrl: string;
}

export interface PostInvestigationPrCommentInput {
    snapshotId: string;
    results: InvestigationTestResult[];
    suggested: SuggestedNewTest[];
    quarantine: QuarantineRecommendation[];
}

export interface PostInvestigationPrCommentOutput {
    /** "posted" (new comment) | "updated" (edited in place) | "skipped" (flag off, or snapshot has no PR). */
    status: "posted" | "updated" | "skipped";
    /** The PR comment id when one was posted or updated; absent when skipped. */
    commentId?: string;
}

// --- Persist add/modify edits onto the investigation snapshot (a proposed suite the merge-with-main step
// later reconciles into main). Persist-only: no generations are queued here.

/** An existing test to repoint to a revised plan on the investigation snapshot. */
export interface InvestigationTestModification {
    slug: string;
    plan: string;
}

/** A brand-new test to add to the investigation snapshot. */
export interface InvestigationNewTest {
    name: string;
    description: string;
    plan: string;
}

export interface PersistInvestigationEditsInput {
    snapshotId: string;
    modifications: InvestigationTestModification[];
    newTests: InvestigationNewTest[];
}

export interface PersistInvestigationEditsOutput {
    /** How many edits were written (0 when nothing applied). */
    persistedCount: number;
    /** Edits that could not be applied, with reasons (never thrown). */
    skipped: { kind: string; ref: string; reason: string }[];
}

// --- Merge-with-main: after a PR merges, reconcile the branch twin's proposed edits into main's current
// suite (which other merges may have moved) and apply the accepted ones onto a detached main-proposal
// snapshot. Shadow-safe: never touches the real (diffs) main suite.

export interface MergeInvestigationEditsInput {
    /** The branch's investigation twin snapshot (holds the proposed edits). */
    twinSnapshotId: string;
    /** Main's current active snapshot - the suite to reconcile into. */
    mainSnapshotId: string;
    /** The main branch, whose active suite the proposal snapshot is cloned from. */
    mainBranchId: string;
    organizationId: string;
}

/** One reconciliation decision, carried out to the report/PR comment. */
export interface InvestigationMergeDecision {
    kind: string;
    ref: string;
    action: string;
    reason: string;
}

export interface MergeInvestigationEditsOutput {
    /** The detached main-proposal snapshot the accepted edits landed on, or undefined when nothing was applied. */
    mainProposalSnapshotId?: string;
    appliedCount: number;
    skippedCount: number;
    decisions: InvestigationMergeDecision[];
}

/** The activities run by the investigation worker (the INVESTIGATION task queue). */
export interface InvestigationActivities {
    selectInvestigationTests(input: SelectInvestigationTestsInput): Promise<SelectInvestigationTestsOutput>;
    classifyInvestigationRun(input: ClassifyInvestigationRunInput): Promise<InvestigationTestResult>;
    writeInvestigationReport(input: WriteInvestigationReportInput): Promise<WriteInvestigationReportOutput>;
    createValidationGeneration(input: CreateValidationGenerationInput): Promise<CreateValidationGenerationOutput>;
    postInvestigationPrComment(input: PostInvestigationPrCommentInput): Promise<PostInvestigationPrCommentOutput>;
    persistInvestigationEdits(input: PersistInvestigationEditsInput): Promise<PersistInvestigationEditsOutput>;
    mergeInvestigationEdits(input: MergeInvestigationEditsInput): Promise<MergeInvestigationEditsOutput>;
}
