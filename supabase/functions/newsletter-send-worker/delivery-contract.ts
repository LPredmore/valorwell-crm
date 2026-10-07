export type NewsletterSendFailure = {
  outcome: 'retry' | 'failed';
  errorCode: string;
  errorMessage: string;
  retryAfterSeconds?: number;
};

export function newsletterIdempotencyKey(emailMessageId: string): string {
  const normalized = emailMessageId.trim();
  if (!normalized) throw new Error('Newsletter email message ID is required');
  return `crm-newsletter/${normalized}`;
}

export function classifyNewsletterSendFailure(input: {
  status?: number | null;
  errorCode?: string | null;
  errorMessage: string;
  retryAfterHeader?: string | null;
  networkError?: boolean;
}): NewsletterSendFailure {
  const errorCode = input.errorCode?.trim()
    || (input.status ? `http_${input.status}` : 'network_error');

  if (input.networkError) {
    return {
      outcome: 'retry',
      errorCode,
      errorMessage: input.errorMessage,
      retryAfterSeconds: 300,
    };
  }

  const status = input.status ?? 0;
  if (status === 429 || status >= 500) {
    return {
      outcome: 'retry',
      errorCode,
      errorMessage: input.errorMessage,
      retryAfterSeconds: retryAfterSeconds(input.retryAfterHeader),
    };
  }

  return {
    outcome: 'failed',
    errorCode,
    errorMessage: input.errorMessage,
  };
}

function retryAfterSeconds(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return 300;
  return Math.max(60, Math.min(parsed, 3600));
}
