import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';

export interface SmsMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  phone: string;
  message: string | null;
  timestamp: string;
  client_id: string | null;
  client_name: string | null;
  status?: string;
}

export interface SmsThread {
  phone: string;
  client_id: string | null;
  client_name: string | null;
  messages: SmsMessage[];
  lastMessageAt: string;
}

export function useSmsConversations() {
  const { tenantId, isAuthenticated } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-sms-conversations', tenantId],
    queryFn: async (): Promise<SmsThread[]> => {
      // Fetch inbound SMS
      const { data: inboundData, error: inboundError } = await supabase
        .from('crm_inbound_sms_logs')
        .select(`
          id,
          from_phone,
          message_body,
          received_at,
          client_id,
          client:client_id (
            pat_name_f,
            pat_name_l,
            pat_name_preferred
          )
        `)
        .eq('tenant_id', tenantId)
        .order('received_at', { ascending: false })
        .limit(200);

      if (inboundError) {
        console.error('Error fetching inbound SMS:', inboundError);
      }

      // Fetch outbound SMS from bulk logs
      const { data: outboundRecipients, error: outboundError } = await supabase
        .from('crm_bulk_sms_recipients')
        .select(`
          id,
          status,
          sent_at,
          client:client_id (
            id,
            phone,
            pat_name_f,
            pat_name_l,
            pat_name_preferred
          ),
          bulk_sms:bulk_sms_id (
            body_text,
            tenant_id
          )
        `)
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(200);

      if (outboundError) {
        console.error('Error fetching outbound SMS:', outboundError);
      }

      // Filter outbound to current tenant
      const filteredOutbound = (outboundRecipients || []).filter(
        (r: any) => r.bulk_sms?.tenant_id === tenantId
      );

      // Build messages list
      const messages: SmsMessage[] = [];

      // Add inbound messages
      for (const sms of inboundData || []) {
        const client = sms.client as any;
        messages.push({
          id: sms.id,
          direction: 'inbound',
          phone: sms.from_phone,
          message: sms.message_body,
          timestamp: sms.received_at,
          client_id: sms.client_id,
          client_name: client
            ? [client.pat_name_preferred || client.pat_name_f, client.pat_name_l].filter(Boolean).join(' ')
            : null,
        });
      }

      // Add outbound messages
      for (const recipient of filteredOutbound) {
        const client = recipient.client as any;
        if (!client?.phone) continue;

        messages.push({
          id: recipient.id,
          direction: 'outbound',
          phone: client.phone,
          message: (recipient.bulk_sms as any)?.body_text || null,
          timestamp: recipient.sent_at!,
          client_id: client.id,
          client_name: [client.pat_name_preferred || client.pat_name_f, client.pat_name_l].filter(Boolean).join(' '),
          status: recipient.status,
        });
      }

      // Group by phone number into threads
      const threadMap = new Map<string, SmsThread>();

      for (const msg of messages) {
        // Normalize phone for grouping
        const normalizedPhone = msg.phone.replace(/\D/g, '').slice(-10);

        if (!threadMap.has(normalizedPhone)) {
          threadMap.set(normalizedPhone, {
            phone: msg.phone,
            client_id: msg.client_id,
            client_name: msg.client_name,
            messages: [],
            lastMessageAt: msg.timestamp,
          });
        }

        const thread = threadMap.get(normalizedPhone)!;
        thread.messages.push(msg);

        // Update client info if we have it
        if (msg.client_id && !thread.client_id) {
          thread.client_id = msg.client_id;
          thread.client_name = msg.client_name;
        }

        // Update last message time
        if (new Date(msg.timestamp) > new Date(thread.lastMessageAt)) {
          thread.lastMessageAt = msg.timestamp;
        }
      }

      // Sort threads by last message time
      const threads = Array.from(threadMap.values()).sort(
        (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );

      // Sort messages within each thread chronologically
      for (const thread of threads) {
        thread.messages.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      }

      return threads;
    },
    enabled: isAuthenticated && !!tenantId,
  });
}
