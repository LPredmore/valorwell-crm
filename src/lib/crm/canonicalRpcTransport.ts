import type { Database } from '@/integrations/supabase/types';
import {
  CONTRACT_VERSION,
  type MutationErrorCode,
  type MutationResult,
} from '@/lib/crm/contracts';

export type CanonicalRpcName =
  | 'crm_transition_lifecycle'
  | 'crm_set_engagement'
  | 'crm_set_contact_policy'
  | 'crm_set_service_policy'
  | 'crm_set_eligibility'
  | 'crm_set_care_cadence'
  | 'crm_assign_clinician'
  | 'crm_close_client'
  | 'crm_reopen_client';

export type CanonicalRpcArgsByName = {
  [K in CanonicalRpcName]: Database['public']['Functions'][K]['Args'];
};

export interface RpcErrorLike {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface CanonicalRpcResponse {
  data: unknown;
  error: RpcErrorLike | null;
}

export type CanonicalRpcCaller = <Name extends CanonicalRpcName>(
  name: Name,
  args: CanonicalRpcArgsByName[Name],
) => PromiseLike<CanonicalRpcResponse>;

export const MAX_CANONICAL_RPC_ATTEMPTS = 2;

export class RetryableCanonicalTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableCanonicalTransportError';
  }
}

export function isMutationResult(value: unknown): value is MutationResult {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'ok' in value && typeof value.ok === 'boolean';
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function isRetryableRpcTransportError(error: unknown): boolean {
  if (error instanceof RetryableCanonicalTransportError) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('fetch failed')
    || message.includes('failed to fetch')
    || message.includes('network')
    || message.includes('timeout')
    || message.includes('temporarily unavailable')
    || message.includes('service unavailable')
    || message.includes('connection terminated')
    || message.includes('connection reset')
    || message.includes('connection refused')
    || message.includes('connection closed');
}

export function isRetryableSupabaseRpcError(error: RpcErrorLike): boolean {
  const text = `${error.code ?? ''} ${error.message} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();
  const code = error.code?.trim() ?? '';
  if (/^[0-9a-z]{5}$/i.test(code) || /^(401|403|pgrst301|pgrst302)$/i.test(code)) return false;
  if (text.includes('permission denied') || text.includes('not authorized') || /\b(unauthorized|authorization|authentication|jwt)\b/.test(text)) return false;
  if (/\b(concurrency|stale|contract)\b/.test(text) || /invalid[_ -]transition/.test(text)) return false;
  return text.includes('fetch')
    || text.includes('network')
    || text.includes('timeout')
    || text.includes('temporarily unavailable')
    || text.includes('service unavailable')
    || text.includes('connection terminated')
    || text.includes('connection reset')
    || text.includes('connection refused')
    || text.includes('connection closed');
}

function mutationErrorCodeForRpcError(error: RpcErrorLike): MutationErrorCode {
  const text = `${error.code ?? ''} ${error.message} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();
  if (text.includes('permission denied') || text.includes('not authorized') || /\b(unauthorized|authorization|authentication|jwt)\b/.test(text)) {
    return 'unauthorized';
  }
  if (/invalid[_ -]transition/.test(text)) return 'invalid_transition';
  if (/\bstale\b/.test(text)) return 'stale_concurrency';
  if (/\bconcurrency\b/.test(text)) return 'concurrency_conflict';
  if (/\bcontract\b/.test(text)) return 'contract_version_mismatch';
  if (/\bsuppression\b/.test(text)) return 'suppression_violation';
  if (/policy[_ -]denied/.test(text)) return 'policy_denied';
  return 'unknown';
}

export function buildCanonicalRpcArgs<T extends Record<string, unknown>>(
  base: T,
  concurrencyToken: string,
  idempotencyKey: string | undefined,
): T & { p_concurrency_token: string; p_idempotency_key: string; p_contract_version: string } {
  return {
    ...base,
    p_concurrency_token: concurrencyToken,
    p_idempotency_key: idempotencyKey ?? newIdempotencyKey(),
    p_contract_version: CONTRACT_VERSION,
  };
}

export async function callCanonicalRpcWithRetry<Name extends CanonicalRpcName>(
  rpc: CanonicalRpcCaller,
  name: Name,
  args: CanonicalRpcArgsByName[Name],
): Promise<MutationResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_CANONICAL_RPC_ATTEMPTS; attempt += 1) {
    try {
      const { data, error } = await rpc(name, args);
      if (error) {
        if (isRetryableSupabaseRpcError(error)) {
          throw new RetryableCanonicalTransportError(error.message);
        }
        return {
          ok: false,
          error_code: mutationErrorCodeForRpcError(error),
          message: error.message,
          rpc_error_code: error.code,
        };
      }
      if (!isMutationResult(data)) {
        return { ok: false, error_code: 'unknown', message: 'Unexpected RPC response' };
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < MAX_CANONICAL_RPC_ATTEMPTS && isRetryableRpcTransportError(error)) continue;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
