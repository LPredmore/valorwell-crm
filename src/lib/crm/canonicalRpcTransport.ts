import type { Database, Json } from '@/integrations/supabase/types';
import { CONTRACT_VERSION, type MutationResult } from '@/lib/crm/contracts';

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

export type CanonicalRpcCaller = <Name extends CanonicalRpcName>(
  name: Name,
  args: CanonicalRpcArgsByName[Name],
) => Promise<{ data: Json; error: RpcErrorLike | null }>;

export class RetryableCanonicalTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableCanonicalTransportError';
  }
}

export function isMutationResult(value: Json): value is MutationResult {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'ok' in value && typeof value.ok === 'boolean';
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function isRetryableRpcTransportError(error: unknown): boolean {
  if (error instanceof RetryableCanonicalTransportError) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return error instanceof TypeError
    || message.includes('fetch failed')
    || message.includes('network')
    || message.includes('timeout')
    || message.includes('temporarily unavailable')
    || message.includes('service unavailable')
    || message.includes('connection terminated');
}

export function isRetryableSupabaseRpcError(error: RpcErrorLike): boolean {
  const text = `${error.code ?? ''} ${error.message} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();
  if (/\b(42501|23514|23503|23505|pgrst301|pgrst302)\b/.test(text)) return false;
  if (text.includes('permission denied') || text.includes('not authorized') || text.includes('jwt')) return false;
  if (text.includes('concurrency') || text.includes('stale') || text.includes('contract') || text.includes('invalid transition')) return false;
  return text.includes('fetch')
    || text.includes('network')
    || text.includes('timeout')
    || text.includes('temporarily unavailable')
    || text.includes('service unavailable')
    || text.includes('connection terminated');
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await rpc(name, args);
      if (error) {
        if (isRetryableSupabaseRpcError(error)) {
          throw new RetryableCanonicalTransportError(error.message);
        }
        return { ok: false, error_code: error.code ?? 'unknown', message: error.message };
      }
      if (!isMutationResult(data)) {
        return { ok: false, error_code: 'unknown', message: 'Unexpected RPC response' };
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && isRetryableRpcTransportError(error)) continue;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
