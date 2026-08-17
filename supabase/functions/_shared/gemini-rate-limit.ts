// Shared rate-limit protection for AUTOMATED/BACKGROUND Gemini workloads.
// All protected automation jobs (AI Operations model worker, BTY discovery,
// BTY contact enrichment, veteran humor Shorts discovery) claim slots from the
// same rolling window in the database, because they share one Gemini project quota.
/** Minimal structural client contract so this module stays importable from browser/test builds. */
export type RpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Conservative shared automation cap; actual Gemini project/model quotas may vary. */
export const GEMINI_AUTOMATION_MAX_STARTS = 8;
export const GEMINI_AUTOMATION_WINDOW_SECONDS = 60;
export const GEMINI_AUTOMATION_SCOPE = "automation";

export class GeminiRateSlotUnavailable extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("A shared Gemini automation rate slot was not available in time.");
    this.name = "GeminiRateSlotUnavailable";
    this.retryAfterMs = retryAfterMs;
  }
}

export type SlotVerdict = { granted: boolean; used: number; max: number; retryAfterMs: number };

/** Bounded, jittered wait between claim attempts so parallel workers do not sync up. */
export function slotBackoffMs(retryAfterMs: number, attempt: number): number {
  const suggested = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 1000;
  const jitter = 100 + Math.floor(Math.random() * 400);
  return Math.min(Math.max(suggested + jitter, 250), 10_000) + attempt * 0;
}

export async function claimGeminiSlot(admin: RpcClient, label: string): Promise<SlotVerdict> {
  const { data, error } = await admin.rpc("gemini_automation_claim_slot", {
    p_scope: GEMINI_AUTOMATION_SCOPE,
    p_max: GEMINI_AUTOMATION_MAX_STARTS,
    p_window_seconds: GEMINI_AUTOMATION_WINDOW_SECONDS,
    p_label: label,
  });
  if (error) throw new Error(`Gemini rate slot claim failed: ${error.message}`);
  const verdict = (data ?? {}) as Partial<SlotVerdict>;
  return {
    granted: verdict.granted === true,
    used: Number(verdict.used ?? 0),
    max: Number(verdict.max ?? GEMINI_AUTOMATION_MAX_STARTS),
    retryAfterMs: Number(verdict.retryAfterMs ?? 1000),
  };
}

/**
 * Waits for a shared Gemini slot. Returns the granting verdict, or throws
 * GeminiRateSlotUnavailable when the budget is still exhausted after maxWaitMs.
 * Waiting is never an analysis failure — callers defer their work instead.
 */
export async function awaitGeminiSlot(
  admin: RpcClient,
  options: { label: string; maxWaitMs?: number },
): Promise<SlotVerdict> {
  const deadline = Date.now() + (options.maxWaitMs ?? 45_000);
  let attempt = 0;
  let last: SlotVerdict = { granted: false, used: 0, max: GEMINI_AUTOMATION_MAX_STARTS, retryAfterMs: 1000 };
  for (;;) {
    last = await claimGeminiSlot(admin, options.label);
    if (last.granted) return last;
    attempt += 1;
    const waitMs = slotBackoffMs(last.retryAfterMs, attempt);
    if (Date.now() + waitMs > deadline) throw new GeminiRateSlotUnavailable(last.retryAfterMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}
