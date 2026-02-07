import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useCrmAuth } from './useCrmAuth';
import type { PatStatus } from '@/lib/crm/types';

interface UpdateStatusParams {
  clientId: string;
  newStatus: PatStatus;
  oldStatus: PatStatus | null;
}

export function useUpdateClientStatus() {
  const queryClient = useQueryClient();
  const { tenantId, userId } = useCrmAuth();

  return useMutation({
    mutationFn: async ({ clientId, newStatus, oldStatus }: UpdateStatusParams) => {
      // 1. Update client status
      const { error: updateError } = await supabase
        .from('clients')
        .update({ pat_status: newStatus })
        .eq('id', clientId);

      if (updateError) {
        throw updateError;
      }

      // 2. Log activity event for audit trail
      if (tenantId && userId) {
        const { error: activityError } = await supabase
          .from('crm_activity_events')
          .insert({
            tenant_id: tenantId,
            client_id: clientId,
            event_type: 'status_change',
            old_value: oldStatus,
            new_value: newStatus,
            created_by_profile_id: userId,
            metadata: {},
          });

        if (activityError) {
          console.error('Failed to log activity event:', activityError);
          // Don't throw - the status was updated successfully
        }
      }

      return { clientId, newStatus };
    },
    onSuccess: ({ clientId }) => {
      // Invalidate queries to refresh client list
      queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      queryClient.invalidateQueries({ queryKey: ['crm-client', clientId] });
      toast({
        title: 'Status updated',
        description: 'Client status has been changed successfully.',
      });
    },
    onError: (error) => {
      console.error('Failed to update status:', error);
      toast({
        title: 'Error',
        description: 'Failed to update client status. Please try again.',
        variant: 'destructive',
      });
    },
  });
}
