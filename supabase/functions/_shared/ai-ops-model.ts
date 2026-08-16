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
