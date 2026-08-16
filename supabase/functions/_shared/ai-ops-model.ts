// Runtime-free model policy for AI Operations. Imported by Deno functions and unit tests alike.

/**
 * Authoritative model for every AI Operations module.
 * `gemini-pro-latest` is the Gemini Developer API alias that always resolves to the
 * current generally-available Gemini **Pro** tier. The pinned `gemini-2.5-pro` id
 * returns 404 ("no longer available to new users") for this project's API key, so the
 * alias is the only working way to guarantee a Pro-class model. It never resolves to Flash.
 */
export const AI_OPS_MODEL = "gemini-pro-latest";

/**
 * Model ids that must never be called: any Flash tier (a cheaper model must never
 * silently take over an analysis module) and retired pinned Pro ids that return 404
 * for this project's API key. Older Phase 2 batch builders persisted
 * `gemini-2.5-pro` into `requested_model`, so the rejection has to happen here.
 */
const REJECTED_MODEL_FRAGMENTS = ["flash", "gemini-2.5-pro", "gemini-1.5"];

/**
 * Picks the first usable model id, ignoring Flash and retired Pro ids so every
 * module lands on the current Pro-class alias.
 */
export function resolveAiOpsModel(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const model = (candidate ?? "").trim().toLowerCase();
    if (!model) continue;
    if (REJECTED_MODEL_FRAGMENTS.some((fragment) => model.includes(fragment))) continue;
    return (candidate ?? "").trim();
  }
  return AI_OPS_MODEL;
}

