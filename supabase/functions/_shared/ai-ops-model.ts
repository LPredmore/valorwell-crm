// Runtime-free model policy for AI Operations. Imported by Deno functions and unit tests alike.

/**
 * Authoritative model for every Gemini-backed AI Operations module.
 * Keep model selection centralized so individual collectors, queued work, settings,
 * or manual worker payloads cannot silently route analysis to a different model.
 */
export const AI_OPS_MODEL = "gemini-2.5-flash";

/**
 * AI Operations uses one authoritative Gemini model. Candidate values are accepted
 * only to preserve the existing call contract and provenance; they do not override
 * the runtime model policy.
 */
export function resolveAiOpsModel(..._candidates: Array<string | null | undefined>): string {
  return AI_OPS_MODEL;
}
