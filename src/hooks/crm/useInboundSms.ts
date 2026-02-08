import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';

export interface InboundSms {
  id: string;
  tenant_id: string;
  client_id: string | null;
  from_phone: string;
  to_phone: string;
  message_body: string | null;
  received_at: string;
  ringcentral_message_id: string | null;
  created_at: string;
  client?: {
    id: string;
    pat_name_f: string | null;
    pat_name_l: string | null;
    pat_name_preferred: string | null;
  } | null;
}

export function useInboundSms() {
  const { tenantId, isAuthenticated } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-inbound-sms', tenantId],
    queryFn: async (): Promise<InboundSms[]> => {
      const { data, error } = await supabase
        .from('crm_inbound_sms_logs')
        .select(`
          *,
          client:client_id (
            id,
            pat_name_f,
            pat_name_l,
            pat_name_preferred
          )
        `)
        .eq('tenant_id', tenantId)
        .order('received_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('Error fetching inbound SMS:', error);
        throw error;
      }

      return (data || []) as InboundSms[];
    },
    enabled: isAuthenticated && !!tenantId,
  });
}
