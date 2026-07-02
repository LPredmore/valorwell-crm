import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useCrmAuth } from './useCrmAuth';
import type { PatStatus } from '@/lib/crm/types';

interface BulkUpdateStatusParams {
  clients: { id: string; oldStatus: PatStatus | null }[];
  newStatus: PatStatus;
}

export function useBulkUpdateStatus() {
  const queryClient = useQueryClient();
  const { tenantId, userId } = useCrmAuth();

  return useMutation({
    mutationFn: async ({ clients, newStatus }: BulkUpdateStatusParams) => {
      if (!tenantId || !userId) {
        throw new Error('Not authenticated');
      }

      const ids = clients.map((c) => c.id);

      const { data, error } = await supabase.rpc('crm_bulk_update_client_status', {
        p_client_ids: ids,
        p_new_status: newStatus,
        p_tenant_id: tenantId,
        p_actor_profile_id: userId,
      });

      if (error) throw error;

      const successCount = (data as unknown as { client_id: string }[] | null)?.length ?? 0;
      const failCount = ids.length - successCount;
      return { successCount, failCount };
    },
    onSuccess: ({ successCount, failCount }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      toast({
        title: 'Status updated',
        description:
          failCount === 0
            ? `${successCount} client${successCount !== 1 ? 's' : ''} updated successfully.`
            : `${successCount} updated, ${failCount} failed.`,
        variant: failCount > 0 ? 'destructive' : undefined,
      });
    },
    onError: (error) => {
      console.error('Bulk status update failed:', error);
      toast({
        title: 'Error',
        description: 'Failed to update client statuses.',
        variant: 'destructive',
      });
    },
  });
}
