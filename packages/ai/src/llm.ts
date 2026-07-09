/**
 * Sharp-free entry point for the LLM / structured-generation primitives.
 *
 * Importing the package barrel (`@autonoma/ai`) transitively loads the vision
 * helpers under `freestyle/`, which value-import `@autonoma/image` -> `sharp`.
 * In environments where sharp's native binary is unavailable (e.g. the API
 * image, which never runs vision code) that import throws at module-eval time
 * - `TypeError: Cannot read properties of undefined (reading 'output')` from
 * `sharp/lib/utility.js` - and takes down every dynamic `import("@autonoma/ai")`
 * with it, silently degrading callers to their heuristic fallbacks.
 *
 * Consumers that only need text / structured generation (no images) must import
 * from `@autonoma/ai/llm` instead of the barrel so the vision graph - and
 * therefore sharp - is never loaded.
 */

export { ModelRegistry, type LanguageModel } from "./registry/model-registry";
export { MODEL_ENTRIES } from "./registry/model-entries";
export { ObjectGenerator, ObjectGenerationFailedError } from "./object/object-generator";
