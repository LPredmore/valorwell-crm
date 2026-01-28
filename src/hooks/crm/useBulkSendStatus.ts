import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BulkSendStatus } from '@/components/crm/bulk/BulkProgressModal';

interface BulkSendStatusData {
  id: string;
  status: BulkSendStatus;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  subject: string;
}

export function useBulkSendStatus(bulkSendId: string | null) {
  return useQuery({
    queryKey: ['bulk-send-status', bulkSendId],
    queryFn: async (): Promise<BulkSendStatusData | null> => {
      if (!bulkSendId) return null;

      const { data, error } = await supabase
        .from('crm_bulk_send_logs')
        .select('id, status, recipient_count, sent_count, failed_count, subject')
        .eq('id', bulkSendId)
        .single();

      if (error) {
        console.error('Failed to fetch bulk send status:', error);
        throw new Error('Failed to fetch status');
      }

      return {
        id: data.id,
        status: data.status as BulkSendStatus,
        recipientCount: data.recipient_count,
        sentCount: data.sent_count,
        failedCount: data.failed_count,
        subject: data.subject,
      };
    },
    enabled: !!bulkSendId,
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
