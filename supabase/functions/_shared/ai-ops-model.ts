// Runtime-free model policy for AI Operations. Imported by Deno functions and unit tests alike.

/** Authoritative model for every AI Operations module. */
export const AI_OPS_MODEL = "gemini-2.5-pro";

/**
 * Picks the first usable model id. Any Flash id is ignored so a cheaper model can
 * never silently take over an analysis module; Gemini 2.5 Pro is the only fallback.
 */
export function resolveAiOpsModel(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const model = (candidate ?? "").trim();
    if (!model || model.toLowerCase().includes("flash")) continue;
    return model;
  }
  return AI_OPS_MODEL;
}
