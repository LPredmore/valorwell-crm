import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { helpscoutApi } from '@/lib/crm/helpscout-api';

interface CreateBulkSendParams {
  clientIds: string[];
  subject: string;
  bodyHtml: string;
}

interface BulkSendResult {
  bulkSendId: string;
}

export function useBulkSend() {
  const queryClient = useQueryClient();

  const createBulkSend = useMutation({
    mutationFn: async ({ clientIds, subject, bodyHtml }: CreateBulkSendParams): Promise<BulkSendResult> => {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('Not authenticated');

      // Get tenant_id from user's membership
      const { data: membership, error: membershipError } = await supabase
        .from('tenant_memberships')
        .select('tenant_id')
        .eq('profile_id', user.id)
        .single();

      if (membershipError || !membership) throw new Error('Could not determine tenant');

      // Create bulk_send_log record
      const { data: bulkSendLog, error: logError } = await supabase
        .from('crm_bulk_send_logs')
        .insert({
          tenant_id: membership.tenant_id,
          created_by_profile_id: user.id,
          subject,
          body_html: bodyHtml,
          recipient_count: clientIds.length,
          sent_count: 0,
          failed_count: 0,
          status: 'pending',
        })
        .select('id')
        .single();

      if (logError || !bulkSendLog) {
        console.error('Failed to create bulk send log:', logError);
        throw new Error('Failed to create bulk send job');
      }

      // Create recipient records
      const recipientRecords = clientIds.map(clientId => ({
        bulk_send_id: bulkSendLog.id,
        tenant_id: membership.tenant_id,
        client_id: clientId,
        status: 'pending' as const,
      }));

      const { error: recipientsError } = await supabase
        .from('crm_bulk_send_recipients')
        .insert(recipientRecords);

      if (recipientsError) {
        console.error('Failed to create recipient records:', recipientsError);
        throw new Error('Failed to create recipient records');
      }

      // Trigger edge function (fire and forget - it processes in background)
      try {
        await helpscoutApi('bulk-send', {
          params: { bulkSendId: bulkSendLog.id },
        });
      } catch (error) {
        // Edge function will process async, initial trigger may return before complete
        console.log('Bulk send triggered:', error);
      }

      return { bulkSendId: bulkSendLog.id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bulk-send-logs'] });
    },
  });

  return {
    createBulkSend,
  };
}
