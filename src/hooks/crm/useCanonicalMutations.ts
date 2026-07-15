import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { RPC, type MutationResult } from '@/lib/crm/contracts';
import {
  buildCanonicalRpcArgs,
  callCanonicalRpcWithRetry,
  newIdempotencyKey,
  type CanonicalRpcArgsByName,
  type CanonicalRpcName,
} from '@/lib/crm/canonicalRpcTransport';

/**
 * All CRM lifecycle mutations route through the nine live RPCs published on
 * contract `valorwell-crm-contracts@1.0.1+20260714`.
 */

export function assertRealToken(token: string | null | undefined): string {
  if (!token || token === 'auto') {
    throw new Error('Concurrency token unavailable — refusing to send "auto"');
  }
  return token;
}

interface BaseArgs {
  client_id: string;
  reason: string;
  concurrency_token: string;
  idempotency_key?: string;
}

const logicalActionKeys = new WeakMap<BaseArgs, string>();

export function idempotencyKeyForLogicalAction<TInput extends BaseArgs>(input: TInput): string {
  const existing = logicalActionKeys.get(input);
  if (existing) return existing;
  const created = input.idempotency_key ?? newIdempotencyKey();
  logicalActionKeys.set(input, created);
  return created;
}

function useCanonicalRpc<Name extends CanonicalRpcName, TInput extends BaseArgs>(
  rpcName: Name,
  successMsg: string,
  buildArgs: (input: TInput) => Omit<CanonicalRpcArgsByName[Name], 'p_concurrency_token' | 'p_idempotency_key' | 'p_contract_version'>,
) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: TInput): Promise<MutationResult> => {
      const token = assertRealToken(input.concurrency_token);
      const args = buildCanonicalRpcArgs(
        buildArgs(input),
        token,
        idempotencyKeyForLogicalAction(input),
      ) as CanonicalRpcArgsByName[Name];
      return callCanonicalRpcWithRetry(supabase.rpc, rpcName, args);
    },
    retry: false,
    onError: (error) => {
      toast({
        title: 'Change failed',
        description: error instanceof Error ? error.message : 'Network request failed',
        variant: 'destructive',
      });
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
  useCanonicalRpc<typeof RPC.transitionLifecycle, LifecycleTransitionArgs>(RPC.transitionLifecycle, 'Lifecycle updated', (i) => ({
    p_client_id: i.client_id,
    p_to_stage: i.to_stage,
    p_reason: i.reason,
    p_disposition_reason: i.disposition_reason ?? null,
  }));

export const useSetEngagement = () =>
  useCanonicalRpc<typeof RPC.setEngagement, EngagementSetArgs>(RPC.setEngagement, 'Engagement updated', (i) => ({
    p_client_id: i.client_id,
    p_to_state: i.to_state,
    p_reason: i.reason,
  }));

export const useSetContactPolicy = () =>
  useCanonicalRpc<typeof RPC.setContactPolicy, ContactPolicySetArgs>(RPC.setContactPolicy, 'Contact policy updated', (i) => ({
    p_client_id: i.client_id,
    p_to_policy: i.to_policy,
    p_reason: i.reason,
  }));

export const useSetServicePolicy = () =>
  useCanonicalRpc<typeof RPC.setServicePolicy, ServicePolicySetArgs>(RPC.setServicePolicy, 'Service policy updated', (i) => ({
    p_client_id: i.client_id,
    p_to_policy: i.to_policy,
    p_reason: i.reason,
  }));

export const useSetEligibility = () =>
  useCanonicalRpc<typeof RPC.setEligibility, EligibilitySetArgs>(RPC.setEligibility, 'Eligibility updated', (i) => ({
    p_client_id: i.client_id,
    p_to_state: i.to_state,
    p_manual_review: i.manual_review ?? null,
    p_reason: i.reason,
  }));

export const useSetCareCadence = () =>
  useCanonicalRpc<typeof RPC.setCareCadence, CareCadenceSetArgs>(RPC.setCareCadence, 'Care cadence updated', (i) => ({
    p_client_id: i.client_id,
    p_to_cadence: i.to_cadence,
    p_reason: i.reason,
  }));

export const useAssignClinician = () =>
  useCanonicalRpc<typeof RPC.assignClinician, AssignClinicianArgs>(RPC.assignClinician, 'Clinician assignment updated', (i) => ({
    p_client_id: i.client_id,
    p_staff_id: i.staff_id,
    p_reason: i.reason,
  }));

export const useCloseClient = () =>
  useCanonicalRpc<typeof RPC.closeClient, CloseClientArgs>(RPC.closeClient, 'Client closed', (i) => ({
    p_client_id: i.client_id,
    p_disposition_reason: i.disposition_reason,
    p_reason: i.reason,
  }));

export const useReopenClient = () =>
  useCanonicalRpc<typeof RPC.reopenClient, ReopenClientArgs>(RPC.reopenClient, 'Client reopened', (i) => ({
    p_client_id: i.client_id,
    p_reason: i.reason,
  }));
