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
      let successCount = 0;
      let failCount = 0;

      await Promise.all(
        clients.map(async ({ id, oldStatus }) => {
          try {
            const { error: updateError } = await supabase
              .from('clients')
              .update({ pat_status: newStatus })
              .eq('id', id);

            if (updateError) throw updateError;

            if (tenantId && userId) {
              await supabase.from('crm_activity_events').insert({
                tenant_id: tenantId,
                client_id: id,
                event_type: 'status_change',
                old_value: oldStatus,
                new_value: newStatus,
                created_by_profile_id: userId,
                metadata: {},
              });
            }

            successCount++;
          } catch (err) {
            console.error(`Failed to update client ${id}:`, err);
            failCount++;
          }
        })
      );

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
