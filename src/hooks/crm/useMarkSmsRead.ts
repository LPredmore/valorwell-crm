import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';

/**
 * Marks all inbound SMS messages in a thread as read.
 * Called when a user selects a thread in the SMS conversation list.
 */
export function useMarkSmsRead() {
  const { tenantId } = useCrmAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (phone: string) => {
      // Normalize the phone number for matching
      const normalizedPhone = phone.replace(/\D/g, '').slice(-10);

      // Get all unread inbound SMS for this phone number in this tenant
      const { data: unreadMessages, error: fetchError } = await supabase
        .from('crm_inbound_sms_logs')
        .select('id, from_phone')
        .eq('tenant_id', tenantId)
        .eq('is_read', false);

      if (fetchError) {
        console.error('Error fetching unread messages:', fetchError);
        throw fetchError;
      }

      // Filter to messages matching this phone number
      const matchingIds = (unreadMessages || [])
        .filter(msg => {
          const msgPhone = msg.from_phone.replace(/\D/g, '').slice(-10);
          return msgPhone === normalizedPhone;
        })
        .map(msg => msg.id);

      if (matchingIds.length === 0) {
        return { updated: 0 };
      }

      // Mark all matching messages as read
      const { error: updateError } = await supabase
        .from('crm_inbound_sms_logs')
        .update({ is_read: true })
        .in('id', matchingIds);

      if (updateError) {
        console.error('Error marking messages as read:', updateError);
        throw updateError;
      }

      return { updated: matchingIds.length };
    },
    onSuccess: () => {
      // Invalidate the SMS conversations query to refresh the unread indicators
      queryClient.invalidateQueries({ queryKey: ['crm-sms-conversations', tenantId] });
    },
  });
}
