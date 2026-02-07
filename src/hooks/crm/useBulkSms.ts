import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ringcentralApi } from '@/lib/crm/ringcentral-api';

interface CreateBulkSmsParams {
  bodyText: string;
  // One of these must be provided
  clientIds?: string[];
  staffIds?: string[];
}

interface BulkSmsResult {
  bulkSmsId: string;
}

export function useBulkSms() {
  const queryClient = useQueryClient();

  const createBulkSms = useMutation({
    mutationFn: async ({ clientIds, staffIds, bodyText }: CreateBulkSmsParams): Promise<BulkSmsResult> => {
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

      // Create bulk_sms_log record with recipient_type
      const { data: bulkSmsLog, error: logError } = await supabase
        .from('crm_bulk_sms_logs')
        .insert({
          tenant_id: membership.tenant_id,
          created_by_profile_id: user.id,
          body_text: bodyText,
          recipient_count: recipientIds.length,
          sent_count: 0,
          failed_count: 0,
          status: 'pending',
          recipient_type: recipientType,
        })
        .select('id')
        .single();

      if (logError || !bulkSmsLog) {
        console.error('Failed to create bulk SMS log:', logError);
        throw new Error('Failed to create bulk SMS job');
      }

      // Create recipient records based on type
      if (isStaffSend) {
        const staffRecipientRecords = recipientIds.map(staffId => ({
          bulk_sms_id: bulkSmsLog.id,
          tenant_id: membership.tenant_id,
          staff_id: staffId,
          status: 'pending' as const,
        }));

        const { error: staffRecipientsError } = await supabase
          .from('crm_bulk_sms_staff_recipients')
          .insert(staffRecipientRecords);

        if (staffRecipientsError) {
          console.error('Failed to create staff recipient records:', staffRecipientsError);
          throw new Error('Failed to create recipient records');
        }
      } else {
        const clientRecipientRecords = recipientIds.map(clientId => ({
          bulk_sms_id: bulkSmsLog.id,
          tenant_id: membership.tenant_id,
          client_id: clientId,
          status: 'pending' as const,
        }));

        const { error: recipientsError } = await supabase
          .from('crm_bulk_sms_recipients')
          .insert(clientRecipientRecords);

        if (recipientsError) {
          console.error('Failed to create recipient records:', recipientsError);
          throw new Error('Failed to create recipient records');
        }
      }

      // Trigger edge function (fire and forget - it processes in background)
      try {
        await ringcentralApi('send', {
          params: { bulkSmsId: bulkSmsLog.id },
        });
      } catch (error) {
        // Edge function will process async, initial trigger may return before complete
        console.log('Bulk SMS triggered:', error);
      }

      return { bulkSmsId: bulkSmsLog.id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bulk-sms-logs'] });
    },
  });

  return {
    createBulkSms,
  };
}
