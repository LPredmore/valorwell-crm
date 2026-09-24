/**
 * Failure model for YouTube publishing. Every thrown error is classified into either a
 * transient failure (retried with backoff, honouring Retry-After) or a permanent one
 * (terminal and shown to the operator). Pure: safe to import from tests.
 */

export class YoutubePublishError extends Error {
  status: number | null;
  retryAfterMs: number | null;
  constructor(message: string, options: { status?: number | null; retryAfterMs?: number | null } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}
export class TransientYoutubeError extends YoutubePublishError {}
export class PermanentYoutubeError extends YoutubePublishError {}

export type PublishFailureKind =
  | "rate_limited" | "server_error" | "network" | "timeout" | "auth" | "validation" | "not_found" | "permanent" | "exhausted";

export type PublishFailureClassification = {
  kind: PublishFailureKind;
  retryable: boolean;
  retryAfterMs: number | null;
};

/** Retries allowed before a transient failure is treated as terminal. */
export const MAX_PUBLISH_ATTEMPTS = 8;

/** Parses an HTTP Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(header: string | null | undefined, nowMs: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - nowMs);
}

/** Converts an HTTP failure into the right error class. 429, 5xx and 408 are transient. */
export function httpFailure(status: number, message: string, retryAfterMs: number | null = null): YoutubePublishError {
  if (status === 429 || status === 408 || status >= 500 || status === 0) {
    return new TransientYoutubeError(message, { status, retryAfterMs });
  }
  return new PermanentYoutubeError(message, { status, retryAfterMs });
}

export function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyPublishFailure(error: unknown, attempts: number): PublishFailureClassification {
  const message = safeError(error).toLowerCase();
  const status = error instanceof YoutubePublishError ? error.status : null;
  const retryAfterMs = error instanceof YoutubePublishError ? error.retryAfterMs : null;

  let classification: PublishFailureClassification;
  if (error instanceof PermanentYoutubeError) {
    const kind: PublishFailureKind = status === 401 || status === 403 ? "auth"
      : status === 404 ? "not_found"
      : status === 400 ? "validation"
      : "permanent";
    classification = { kind, retryable: false, retryAfterMs: null };
  } else if (status === 429) {
    classification = { kind: "rate_limited", retryable: true, retryAfterMs };
  } else if (status !== null && status >= 500) {
    classification = { kind: "server_error", retryable: true, retryAfterMs };
  } else if (error instanceof TransientYoutubeError) {
    classification = { kind: "server_error", retryable: true, retryAfterMs };
  } else if (message.includes("oauth token refresh failed") || message.includes("token refresh failed")) {
    // An expired/revoked refresh token never fixes itself; the operator must re-consent.
    classification = { kind: "auth", retryable: false, retryAfterMs: null };
  } else if (message.includes("timeout") || message.includes("timed out") || message.includes("aborted")) {
    classification = { kind: "timeout", retryable: true, retryAfterMs: null };
  } else if (error instanceof TypeError || message.includes("network") || message.includes("fetch failed") ||
    message.includes("connection")) {
    classification = { kind: "network", retryable: true, retryAfterMs: null };
  } else {
    // Unknown, unclassified failures (e.g. a Drive 5xx surfaced as a plain Error) are retried,
    // but only up to MAX_PUBLISH_ATTEMPTS below.
    classification = { kind: "server_error", retryable: true, retryAfterMs: null };
  }

  if (classification.retryable && attempts >= MAX_PUBLISH_ATTEMPTS) {
    return { kind: "exhausted", retryable: false, retryAfterMs: null };
  }
  return classification;
}

/** Exponential backoff (60s, 120s, 240s, ... capped at 30 minutes), never shorter than Retry-After. */
export function retryDelayMs(attempts: number, retryAfterMs: number | null): number {
  const backoff = Math.min(Math.pow(2, Math.max(attempts, 1)) * 30, 1800) * 1000;
  return Math.max(backoff, retryAfterMs ?? 0);
}
