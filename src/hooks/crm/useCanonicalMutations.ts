import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import { useToast } from '@/hooks/use-toast';
import {
  RPC,
  CONTRACT_VERSION,
  type MutationResult,
} from '@/lib/crm/contracts';

/**
 * All CRM lifecycle mutations route through the nine live RPCs published on
 * contract `valorwell-crm-contracts@1.0.1+20260714`. Every call:
 *   - sends the exact contract version constant (fail-closed on mismatch),
 *   - sends a real concurrency token pulled from v_client_canonical_state
 *     by the caller (never the literal string "auto"),
 *   - sends a fresh client-generated idempotency key so retries are safe,
 *   - never reports success unless the RPC returned `{ ok: true }`.
 */

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function assertRealToken(token: string | null | undefined): string {
  if (!token || token === 'auto') {
    throw new Error('Concurrency token unavailable — refusing to send "auto"');
  }
  return token;
}

/**
 * Pure builder for canonical RPC args. Exposed for idempotency-key tests:
 * a caller-provided key must be forwarded verbatim (retry safety); an
 * absent key must produce a fresh UUID per invocation (new-action safety).
 */
export function buildCanonicalRpcArgs(
  base: Record<string, unknown>,
  concurrencyToken: string,
  idempotencyKey: string | undefined,
): Record<string, unknown> {
  return {
    ...base,
    p_concurrency_token: concurrencyToken,
    p_idempotency_key: idempotencyKey ?? newIdempotencyKey(),
    p_contract_version: CONTRACT_VERSION,
  };
}

interface BaseArgs {
  client_id: string;
  reason: string;
  concurrency_token: string;
  idempotency_key?: string;
}

type CanonicalRpcName = (typeof RPC)[keyof typeof RPC];
type CanonicalRpcArgs = Database['public']['Functions'][CanonicalRpcName]['Args'];

function isMutationResult(value: Json): value is MutationResult {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'ok' in value && typeof value.ok === 'boolean';
}

function useCanonicalRpc<TInput extends BaseArgs>(
  rpcName: CanonicalRpcName,
  successMsg: string,
  buildArgs: (input: TInput) => Omit<CanonicalRpcArgs, 'p_concurrency_token' | 'p_idempotency_key' | 'p_contract_version'>,
) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: TInput): Promise<MutationResult> => {
      const token = assertRealToken(input.concurrency_token);
      const args = buildCanonicalRpcArgs(
        buildArgs(input),
        token,
        input.idempotency_key,
      );
      const { data, error } = await supabase.rpc(rpcName, args as CanonicalRpcArgs);
      if (error) {
        return { ok: false, error_code: 'unknown', message: error.message };
      }
      if (!isMutationResult(data)) {
        return { ok: false, error_code: 'unknown', message: 'Unexpected RPC response' };
      }
      return data;
    },
    onSuccess: (result, input) => {
      if (!result.ok) {
        toast({
          title: 'Change refused',
          description: result.message ?? result.error_code ?? 'Unknown error',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: successMsg });
      qc.invalidateQueries({ queryKey: ['canonical-client-state'] });
      qc.invalidateQueries({ queryKey: ['canonical-client-states'] });
      qc.invalidateQueries({ queryKey: ['crm-clients'] });
      qc.invalidateQueries({ queryKey: ['crm-client', input.client_id] });
      qc.invalidateQueries({ queryKey: ['crm-activity', input.client_id] });
    },
  });
}

export interface LifecycleTransitionArgs extends BaseArgs {
  to_stage: string;
  disposition_reason?: string | null;
}
export interface EngagementSetArgs extends BaseArgs { to_state: string; }
export interface ContactPolicySetArgs extends BaseArgs { to_policy: string; }
export interface ServicePolicySetArgs extends BaseArgs { to_policy: string; }
export interface EligibilitySetArgs extends BaseArgs {
  to_state: string;
  manual_review?: {
    owner: string;
    next_action: string;
    review_due_at: string;
  } | null;
}
export interface CareCadenceSetArgs extends BaseArgs { to_cadence: string; }
export interface AssignClinicianArgs extends BaseArgs { staff_id: string; }
export interface CloseClientArgs extends BaseArgs { disposition_reason: string; }
export type ReopenClientArgs = BaseArgs;

export const useTransitionLifecycle = () =>
  useCanonicalRpc<LifecycleTransitionArgs>(RPC.transitionLifecycle, 'Lifecycle updated', (i) => ({
    p_client_id: i.client_id,
    p_to_stage: i.to_stage,
    p_reason: i.reason,
    p_disposition_reason: i.disposition_reason ?? null,
  }));

export const useSetEngagement = () =>
  useCanonicalRpc<EngagementSetArgs>(RPC.setEngagement, 'Engagement updated', (i) => ({
    p_client_id: i.client_id,
    p_to_state: i.to_state,
    p_reason: i.reason,
  }));

export const useSetContactPolicy = () =>
  useCanonicalRpc<ContactPolicySetArgs>(RPC.setContactPolicy, 'Contact policy updated', (i) => ({
    p_client_id: i.client_id,
    p_to_policy: i.to_policy,
    p_reason: i.reason,
  }));

export const useSetServicePolicy = () =>
  useCanonicalRpc<ServicePolicySetArgs>(RPC.setServicePolicy, 'Service policy updated', (i) => ({
    p_client_id: i.client_id,
    p_to_policy: i.to_policy,
    p_reason: i.reason,
  }));

export const useSetEligibility = () =>
  useCanonicalRpc<EligibilitySetArgs>(RPC.setEligibility, 'Eligibility updated', (i) => ({
    p_client_id: i.client_id,
    p_to_state: i.to_state,
    p_manual_review: i.manual_review ?? null,
    p_reason: i.reason,
  }));

export const useSetCareCadence = () =>
  useCanonicalRpc<CareCadenceSetArgs>(RPC.setCareCadence, 'Care cadence updated', (i) => ({
    p_client_id: i.client_id,
    p_to_cadence: i.to_cadence,
    p_reason: i.reason,
  }));

export const useAssignClinician = () =>
  useCanonicalRpc<AssignClinicianArgs>(RPC.assignClinician, 'Clinician assignment updated', (i) => ({
    p_client_id: i.client_id,
    p_staff_id: i.staff_id,
    p_reason: i.reason,
  }));

export const useCloseClient = () =>
  useCanonicalRpc<CloseClientArgs>(RPC.closeClient, 'Client closed', (i) => ({
    p_client_id: i.client_id,
    p_disposition_reason: i.disposition_reason,
    p_reason: i.reason,
  }));

export const useReopenClient = () =>
  useCanonicalRpc<ReopenClientArgs>(RPC.reopenClient, 'Client reopened', (i) => ({
    p_client_id: i.client_id,
    p_reason: i.reason,
  }));
