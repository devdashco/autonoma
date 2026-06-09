import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCases } from "@autonoma/evals";
import { resolveCasesDir } from "../framework/cases-dir";
import { GenerationReviewEvaluation } from "./generation-review-evaluation";
import { generationReviewFrontmatterSchema } from "./generation-review-frontmatter";
import { generationReviewCaseInputSchema } from "./generation-review-input";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = resolveCasesDir("generation-review");
const RESULTS_DIR = path.join(__dirname, "results");

const cases = loadCases({
    casesDir: CASES_DIR,
    inputSchema: generationReviewCaseInputSchema,
    frontmatterSchema: generationReviewFrontmatterSchema,
});

new GenerationReviewEvaluation(RESULTS_DIR, cases).runEvaluation();
