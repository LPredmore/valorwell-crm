import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useCrmAuth } from './useCrmAuth';
import type { PatStatus } from '@/lib/crm/types';
import { RPC, CONTRACT_VERSION } from '@/lib/crm/contracts';

interface UpdateStatusParams {
  clientId: string;
  newStatus: PatStatus;
  oldStatus: PatStatus | null;
}

/**
 * Fail-closed lifecycle transition.
 *
 * Direct writes to `public.clients.pat_status` are prohibited from the CRM.
 * This hook routes every status change through the canonical
 * `crm_transition_lifecycle` RPC. If the RPC is not yet deployed the mutation
 * surfaces a CONTRACT_NOT_DEPLOYED toast rather than silently falling back to
 * a legacy write path.
 */
export function useUpdateClientStatus() {
  const queryClient = useQueryClient();
  const { tenantId, userId } = useCrmAuth();

  return useMutation({
    mutationFn: async ({ clientId, newStatus, oldStatus }: UpdateStatusParams) => {
      if (!tenantId || !userId) {
        throw new Error('Not authenticated');
      }

      const idempotencyKey =
        (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
        `${clientId}-${Date.now()}`;

      const { data, error } = await (supabase as any).rpc(RPC.transitionLifecycle, {
        client_id: clientId,
        to_stage: newStatus,
        reason: `Manual status change from ${oldStatus ?? 'unassigned'} to ${newStatus}`,
        idempotency_key: idempotencyKey,
        contract_version: CONTRACT_VERSION,
      });

      if (error) {
        const code =
          error.code === 'PGRST202' || /function .* does not exist/i.test(error.message)
            ? 'CONTRACT_NOT_DEPLOYED'
            : (error.code ?? 'unknown');
        const err = new Error(error.message);
        (err as Error & { code?: string }).code = code;
        throw err;
      }

      if (data && data.ok === false) {
        const err = new Error(data.message ?? data.error_code ?? 'Change refused');
        (err as Error & { code?: string }).code = data.error_code ?? 'refused';
        throw err;
      }

      return { clientId, newStatus };
    },
    onSuccess: ({ clientId }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      queryClient.invalidateQueries({ queryKey: ['crm-client', clientId] });
      queryClient.invalidateQueries({ queryKey: ['canonical-client-state'] });
      queryClient.invalidateQueries({ queryKey: ['canonical-client-states'] });
      toast({
        title: 'Status updated',
        description: 'Lifecycle transition recorded.',
      });
    },
    onError: (error) => {
      const code = (error as Error & { code?: string }).code;
      console.error('Failed to update status:', error);
      if (code === 'CONTRACT_NOT_DEPLOYED') {
        toast({
          title: 'Backend contract not deployed',
          description:
            'crm_transition_lifecycle RPC is not published yet. Status change was NOT applied. See docs/crm-backend-delivery-request.md.',
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Change refused',
        description: (error as Error).message || 'Failed to update client status.',
        variant: 'destructive',
      });
    },
  });
}
