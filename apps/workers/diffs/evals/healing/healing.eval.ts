import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCases } from "@autonoma/evals";
import { resolveCasesDir } from "../framework/cases-dir";
import { HealingEvaluation, validateHealingCase } from "./healing-evaluation";
import { healingFrontmatterSchema } from "./healing-frontmatter";
import { healingCaseInputSchema } from "./healing-input";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = resolveCasesDir("healing");
const RESULTS_DIR = path.join(__dirname, "results");

const cases = loadCases({
    casesDir: CASES_DIR,
    inputSchema: healingCaseInputSchema,
    frontmatterSchema: healingFrontmatterSchema,
});

for (const c of cases) validateHealingCase(c);

new HealingEvaluation(RESULTS_DIR, cases).runEvaluation();
