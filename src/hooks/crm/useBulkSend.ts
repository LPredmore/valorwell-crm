import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { helpscoutApi } from '@/lib/crm/helpscout-api';

interface CreateBulkSendParams {
  subject: string;
  bodyHtml: string;
  // One of these must be provided
  clientIds?: string[];
  staffIds?: string[];
}

interface BulkSendResult {
  bulkSendId: string;
}

export function useBulkSend() {
  const queryClient = useQueryClient();

  const createBulkSend = useMutation({
    mutationFn: async ({ clientIds, staffIds, subject, bodyHtml }: CreateBulkSendParams): Promise<BulkSendResult> => {
      // Determine recipient type from which IDs are provided
      const isStaffSend = staffIds && staffIds.length > 0;
      const recipientIds = isStaffSend ? staffIds : (clientIds || []);
      const recipientType = isStaffSend ? 'staff' : 'client';

      if (recipientIds.length === 0) {
        throw new Error('No recipients provided');
      }

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

      // Create bulk_send_log record with recipient_type
      const { data: bulkSendLog, error: logError } = await supabase
        .from('crm_bulk_send_logs')
        .insert({
          tenant_id: membership.tenant_id,
          created_by_profile_id: user.id,
          subject,
          body_html: bodyHtml,
          recipient_count: recipientIds.length,
          sent_count: 0,
          failed_count: 0,
          status: 'pending',
          recipient_type: recipientType,
        })
        .select('id')
        .single();

      if (logError || !bulkSendLog) {
        console.error('Failed to create bulk send log:', logError);
        throw new Error('Failed to create bulk send job');
      }

      // Create recipient records based on type
      if (isStaffSend) {
        const staffRecipientRecords = recipientIds.map(staffId => ({
          bulk_send_id: bulkSendLog.id,
          tenant_id: membership.tenant_id,
          staff_id: staffId,
          status: 'pending' as const,
        }));

        const { error: staffRecipientsError } = await supabase
          .from('crm_bulk_send_staff_recipients')
          .insert(staffRecipientRecords);

        if (staffRecipientsError) {
          console.error('Failed to create staff recipient records:', staffRecipientsError);
          throw new Error('Failed to create recipient records');
        }
      } else {
        const clientRecipientRecords = recipientIds.map(clientId => ({
          bulk_send_id: bulkSendLog.id,
          tenant_id: membership.tenant_id,
          client_id: clientId,
          status: 'pending' as const,
        }));

        const { error: recipientsError } = await supabase
          .from('crm_bulk_send_recipients')
          .insert(clientRecipientRecords);

        if (recipientsError) {
          console.error('Failed to create recipient records:', recipientsError);
          throw new Error('Failed to create recipient records');
        }
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
