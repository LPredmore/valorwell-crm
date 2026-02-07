import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type BulkSmsStatus = 'pending' | 'sending' | 'completed' | 'failed';

interface BulkSmsStatusData {
  id: string;
  status: BulkSmsStatus;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  bodyText: string;
}

export function useBulkSmsStatus(bulkSmsId: string | null) {
  return useQuery({
    queryKey: ['bulk-sms-status', bulkSmsId],
    queryFn: async (): Promise<BulkSmsStatusData | null> => {
      if (!bulkSmsId) return null;

      const { data, error } = await supabase
        .from('crm_bulk_sms_logs')
        .select('id, status, recipient_count, sent_count, failed_count, body_text')
        .eq('id', bulkSmsId)
        .single();

      if (error) {
        console.error('Failed to fetch bulk SMS status:', error);
        throw new Error('Failed to fetch status');
      }

      return {
        id: data.id,
        status: data.status as BulkSmsStatus,
        recipientCount: data.recipient_count,
        sentCount: data.sent_count,
        failedCount: data.failed_count,
        bodyText: data.body_text,
      };
    },
    enabled: !!bulkSmsId,
    // Poll every 2 seconds while sending
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      if (data.status === 'pending' || data.status === 'sending') {
        return 2000;
      }
      return false; // Stop polling when complete
    },
  });
}
