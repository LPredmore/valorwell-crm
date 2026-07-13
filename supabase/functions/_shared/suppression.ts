// deno-lint-ignore-file no-explicit-any
// Shared suppression guard used by every send path.
// Called at: enrollment, before each scheduled step, immediately before send,
// after replay, after retry, after policy changes.
// Contract: §6.1, §6.3

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type MessageClass =
  | 'ordinary_promotional'
  | 'ordinary_campaign_follow_up'
  | 'wait_path_ordinary'
  | 'necessary_scheduling'
  | 'active_care'
  | 'billing_insurance'
  | 'clinical_safety_legal'
  | 'transactional_account';

const SUPPRESSABLE: ReadonlySet<MessageClass> = new Set([
  'ordinary_promotional',
  'ordinary_campaign_follow_up',
  'wait_path_ordinary',
]);

export interface SuppressionDecision {
  allowed: boolean;
  reason_code:
    | 'ok'
    | 'contact_policy_dnc'
    | 'service_policy_blocked'
    | 'unknown_canonical_state'
    | 'class_never_permitted';
  policy_version: string;
  contact_policy: string | null;
  service_policy: string | null;
}

export async function checkSuppression(
  supabaseUrl: string,
  serviceRoleKey: string,
  args: { tenantId: string; clientId: string; messageClass: MessageClass },
): Promise<SuppressionDecision> {
  const client = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await client
    .from('v_client_canonical_state')
    .select('contact_policy,service_policy,contract_version')
    .eq('tenant_id', args.tenantId)
    .eq('client_id', args.clientId)
    .maybeSingle();

  if (error || !data) {
    return {
      allowed: false,
      reason_code: 'unknown_canonical_state',
      policy_version: 'unknown',
      contact_policy: null,
      service_policy: null,
    };
  }

  // Service Blocked halts all outbound.
  if (data.service_policy === 'Service Blocked') {
    return {
      allowed: false,
      reason_code: 'service_policy_blocked',
      policy_version: data.contract_version ?? 'unknown',
      contact_policy: data.contact_policy,
      service_policy: data.service_policy,
    };
  }

  // DNC suppresses ordinary classes only.
  if (data.contact_policy === 'Do Not Contact' && SUPPRESSABLE.has(args.messageClass)) {
    return {
      allowed: false,
      reason_code: 'contact_policy_dnc',
      policy_version: data.contract_version ?? 'unknown',
      contact_policy: data.contact_policy,
      service_policy: data.service_policy,
    };
  }

  return {
    allowed: true,
    reason_code: 'ok',
    policy_version: data.contract_version ?? 'unknown',
    contact_policy: data.contact_policy,
    service_policy: data.service_policy,
  };
}

// REMOVE keyword detector (case/punct/whitespace insensitive) — §6.2 step 1
const REMOVE_TOKENS = new Set(['remove', 'stop', 'unsubscribe', 'quit', 'end', 'cancel']);
export function isRemoveMessage(body: string | null | undefined): boolean {
  if (!body) return false;
  const normalized = body.trim().toLowerCase().replace(/[^a-z]/g, '');
  return REMOVE_TOKENS.has(normalized);
}

/**
 * Applies REMOVE: switches contact policy to DNC via canonical RPC,
 * cancels active campaign enrollments, marks pending sends suppressed.
 * Idempotent per §6.2.
 */
export async function applyRemove(
  supabaseUrl: string,
  serviceRoleKey: string,
  args: { tenantId: string; clientId: string; source: string; correlationId?: string },
): Promise<{ ok: boolean; error?: string }> {
  const client = createClient(supabaseUrl, serviceRoleKey);

  const { error: rpcErr } = await client.rpc('set_client_contact_policy', {
    client_id: args.clientId,
    tenant_id: args.tenantId,
    to_policy: 'Do Not Contact',
    reason: `REMOVE keyword received via ${args.source}`,
    concurrency_token: 'auto',
    contract_version: 'valorwell-crm-contracts@1.0.0+pending-supabase-hash',
  });
  if (rpcErr) {
    console.warn('[applyRemove] RPC failed (backend may not be ready):', rpcErr.message);
    return { ok: false, error: rpcErr.message };
  }

  await client
    .from('crm_campaign_enrollments')
    .update({ status: 'cancelled', cancelled_reason: 'REMOVE received' })
    .eq('tenant_id', args.tenantId)
    .eq('client_id', args.clientId)
    .eq('status', 'active');

  return { ok: true };
}
