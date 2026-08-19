// Runtime-free model policy for AI Operations. Imported by Deno functions and unit tests alike.

/**
 * Authoritative model for every Gemini-backed AI Operations module.
 * Keep model selection centralized so individual collectors, queued work, settings,
 * or manual worker payloads cannot silently route analysis to a different model.
 */
export const AI_OPS_MODEL = "gemini-3.6-flash";

/**
 * AI Operations uses one authoritative Gemini model. Candidate values are accepted
 * only to preserve the existing call contract and provenance; they do not override
 * the runtime model policy.
 */
export function resolveAiOpsModel(..._candidates: Array<string | null | undefined>): string {
  return AI_OPS_MODEL;
}

/**
 * The tenant setting is the hard ceiling for model-worker concurrency. A request may
 * lower the limit for a one-off invocation, but can never raise it above the control
 * plane setting. Invalid/missing configuration fails conservatively to 2 workers.
 */
export function boundedModelWorkerBatchSize(
  configuredLimit: unknown,
  requestedLimit?: unknown,
): number {
  const configuredNumber = Number(configuredLimit);
  const configured = Number.isFinite(configuredNumber)
    ? Math.min(Math.max(Math.trunc(configuredNumber), 1), 20)
    : 2;

  if (requestedLimit === undefined || requestedLimit === null) return configured;

  const requestedNumber = Number(requestedLimit);
  if (!Number.isFinite(requestedNumber)) return configured;
  return Math.min(Math.max(Math.trunc(requestedNumber), 1), configured);
}
