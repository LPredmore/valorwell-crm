import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  RPC,
  CONTRACT_VERSION,
  type LifecycleTransitionInput,
  type EngagementSetInput,
  type ContactPolicySetInput,
  type ServicePolicySetInput,
  type EligibilitySetInput,
  type CareCadenceSetInput,
  type MutationResult,
} from '@/lib/crm/contracts';

function useCanonicalRpc<TInput extends { client_id: string }>(
  rpcName: string,
  successMsg: string,
) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: TInput): Promise<MutationResult> => {
      const { data, error } = await (supabase as any).rpc(rpcName, {
        ...input,
        contract_version: input['contract_version' as keyof TInput] ?? CONTRACT_VERSION,
      });
      if (error) {
        return { ok: false, error_code: 'unknown', message: error.message };
      }
      return (data ?? { ok: true }) as MutationResult;
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

export const useTransitionLifecycle = () =>
  useCanonicalRpc<LifecycleTransitionInput>(RPC.transitionLifecycle, 'Lifecycle updated');
export const useSetEngagement = () =>
  useCanonicalRpc<EngagementSetInput>(RPC.setEngagement, 'Engagement updated');
export const useSetContactPolicy = () =>
  useCanonicalRpc<ContactPolicySetInput>(RPC.setContactPolicy, 'Contact policy updated');
export const useSetServicePolicy = () =>
  useCanonicalRpc<ServicePolicySetInput>(RPC.setServicePolicy, 'Service policy updated');
export const useSetEligibility = () =>
  useCanonicalRpc<EligibilitySetInput>(RPC.setEligibility, 'Eligibility updated');
export const useSetCareCadence = () =>
  useCanonicalRpc<CareCadenceSetInput>(RPC.setCareCadence, 'Care cadence updated');
