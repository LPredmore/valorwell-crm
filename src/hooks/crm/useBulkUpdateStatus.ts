import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useCrmAuth } from './useCrmAuth';
import type { PatStatus } from '@/lib/crm/types';
import { RPC, CONTRACT_VERSION } from '@/lib/crm/contracts';

interface BulkUpdateStatusParams {
  clients: { id: string; oldStatus: PatStatus | null }[];
  newStatus: PatStatus;
}

/**
 * Fail-closed bulk lifecycle transition.
 *
 * Fans out to `crm_transition_lifecycle` per client. No direct writes to
 * `public.clients.pat_status`. If the canonical RPC is not deployed the whole
 * operation surfaces `CONTRACT_NOT_DEPLOYED` and NO clients are modified.
 */
export function useBulkUpdateStatus() {
  const queryClient = useQueryClient();
  const { tenantId, userId } = useCrmAuth();

  return useMutation({
    mutationFn: async ({ clients, newStatus }: BulkUpdateStatusParams) => {
      if (!tenantId || !userId) {
        throw new Error('Not authenticated');
      }

      // Probe first client — if RPC missing, refuse the whole batch.
      let successCount = 0;
      let failCount = 0;
      let contractMissing = false;

      for (const c of clients) {
        const idempotencyKey =
          (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
          `${c.id}-${Date.now()}`;

        const { data, error } = await (supabase as any).rpc(RPC.transitionLifecycle, {
          client_id: c.id,
          to_stage: newStatus,
          reason: `Bulk status change to ${newStatus}`,
          idempotency_key: idempotencyKey,
          contract_version: CONTRACT_VERSION,
        });

        if (error) {
          if (error.code === 'PGRST202' || /function .* does not exist/i.test(error.message)) {
            contractMissing = true;
            break;
          }
          failCount++;
          continue;
        }
        if (data && data.ok === false) {
          failCount++;
          continue;
        }
        successCount++;
      }

      if (contractMissing) {
        const err = new Error(
          'crm_transition_lifecycle RPC is not deployed. Batch aborted; no clients were modified.',
        );
        (err as Error & { code?: string }).code = 'CONTRACT_NOT_DEPLOYED';
        throw err;
      }

      return { successCount, failCount };
    },
    onSuccess: ({ successCount, failCount }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      queryClient.invalidateQueries({ queryKey: ['canonical-client-state'] });
      queryClient.invalidateQueries({ queryKey: ['canonical-client-states'] });
      toast({
        title: 'Bulk status update',
        description:
          failCount === 0
            ? `${successCount} client${successCount !== 1 ? 's' : ''} updated.`
            : `${successCount} updated, ${failCount} refused.`,
        variant: failCount > 0 ? 'destructive' : undefined,
      });
    },
    onError: (error) => {
      const code = (error as Error & { code?: string }).code;
      console.error('Bulk status update failed:', error);
      toast({
        title:
          code === 'CONTRACT_NOT_DEPLOYED'
            ? 'Backend contract not deployed'
            : 'Bulk update failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    },
  });
}
