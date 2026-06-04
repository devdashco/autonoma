export {
    type CodebaseCoords,
    codebaseCoordsSchema,
    ensureCachedCheckout,
    type EnsureCachedCheckoutOptions,
    UnfetchableShaError,
} from "./codebase-cache";
export { type CaseLoaderConfig, type LoadedCase, loadCases } from "./case-loader";
export { requireCasesDir, resolveCasesDir } from "./cases-dir";
export { env as evalEnv } from "./env";
export {
    type CheckFailure,
    type ConfidenceBand,
    type CountBounds,
    type IdentifierSetCheck,
    CASE_SCHEMA_VERSION,
    baseFrontmatterSchema,
    checkConfidenceBand,
    checkCountBounds,
    checkEnumEquality,
    checkIdentifierSet,
    confidenceBandSchema,
    countBoundsSchema,
    identifierSetCheckSchema,
} from "./frontmatter";
export { DiffsJudge, type JudgeParams, type JudgeResult, type JudgeVerdict, judgeVerdictSchema } from "./judge";
export { type EvidenceKeys, MissingEvidenceError, probeEvidence } from "./evidence-probe";
