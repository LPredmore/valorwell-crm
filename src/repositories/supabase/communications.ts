import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { CommunicationsRepository } from '../types';
import type { CommunicationMessage, CommunicationPolicyResult } from '@/domain/operations';
import { supabaseClientsRepository } from './clients';
import { resendEmailApi } from '@/lib/crm/resend-api';

/**
 * Canonical communications adapter.
 *
 * Email delivery and receiving are provider-neutral in the database and use
 * Resend exclusively at the transport boundary. SMS remains on RingCentral.
 */

type BulkSmsRow = Tables<'crm_bulk_sms_recipients'>;
type InboundSmsRow = Tables<'crm_inbound_sms_logs'>;
type CrmNoteRow = Tables<'crm_notes'>;

type CrmEmailMessageRow = {
  id: string;
  tenant_id: string;
  client_id: string | null;
  campaign_id: string | null;
  direction: 'inbound' | 'outbound';
  status: string;
  sender_email: string;
  recipient_email: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  in_reply_to_message_id: string | null;
  message_class: string | null;
  error_message: string | null;
  occurred_at: string;
  created_at: string;
};

const untypedSupabase = supabase as unknown as {
  from: (relation: string) => any;
};

function mapEmailStatus(status: string): CommunicationMessage['status'] {
  if (status === 'queued' || status === 'scheduled' || status === 'delivery_delayed') return 'queued';
  if (status === 'sent') return 'sent';
  if (status === 'delivered') return 'delivered';
  if (status === 'received') return 'received';
  if (status === 'suppressed') return 'suppressed';
  return 'failed';
}

function rowInboundSms(row: InboundSmsRow, tenantId: string): CommunicationMessage {
  return {
    id: `insms-${row.id}`,
    tenantId,
    clientId: row.client_id ?? undefined,
    channel: 'sms',
    direction: 'inbound',
    from: row.from_phone,
    to: row.to_phone,
    body: row.message_body ?? '',
    status: 'received',
    threadId: `sms:${row.client_id ?? row.from_phone}`,
    createdAt: row.received_at ?? row.created_at,
  };
}

function rowBulkSms(row: BulkSmsRow, tenantId: string): CommunicationMessage {
  const status: CommunicationMessage['status'] =
    row.status === 'sent'
      ? 'sent'
      : row.status === 'failed'
        ? 'failed'
        : row.status === 'suppressed'
          ? 'suppressed'
          : 'queued';
  return {
    id: `bulksms-${row.id}`,
    tenantId,
    clientId: row.client_id,
    channel: 'sms',
    direction: 'outbound',
    from: 'bulk-sms',
    to: row.client_id,
    body: row.error_message ?? '',
    status,
    suppressionReason: row.status === 'suppressed' ? row.error_message ?? undefined : undefined,
    threadId: `sms:${row.client_id}`,
    createdAt: row.sent_at ?? row.created_at,
  };
}

function rowEmailMessage(row: CrmEmailMessageRow): CommunicationMessage {
  const threadKey = row.provider_thread_id || row.in_reply_to_message_id || row.provider_message_id || row.id;
  const status = mapEmailStatus(row.status);
  return {
    id: `email-${row.id}`,
    tenantId: row.tenant_id,
    clientId: row.client_id ?? undefined,
    channel: 'email',
    direction: row.direction,
    from: row.sender_email,
    to: row.recipient_email,
    subject: row.subject ?? undefined,
    body: row.body_text ?? row.body_html ?? '',
    status,
    suppressionReason: status === 'failed' || status === 'suppressed' ? row.error_message ?? undefined : undefined,
    campaignId: row.campaign_id ?? undefined,
    messageClass: row.message_class as CommunicationMessage['messageClass'],
    threadId: `email:${threadKey}`,
    createdAt: row.occurred_at || row.created_at,
  };
}

function rowCrmNote(row: CrmNoteRow): CommunicationMessage {
  return {
    id: `note-${row.id}`,
    tenantId: row.tenant_id,
    clientId: row.client_id ?? undefined,
    channel: 'note',
    direction: 'outbound',
    from: row.created_by_profile_id,
    to: row.client_id ?? '',
    body: row.note_content,
    status: 'delivered',
    threadId: `note:${row.client_id ?? row.id}`,
    createdAt: row.created_at,
  };
}

async function tenantForClient(clientId: string): Promise<string> {
  const { data } = await supabase
    .from('clients')
    .select('tenant_id')
    .eq('id', clientId)
    .maybeSingle();
  return data?.tenant_id ?? '';
}

async function evaluateCommunicationPolicy(input: {
  clientId: string;
  channel: 'sms' | 'email';
  messageClass: import('@/domain/operations').CanonicalMessageClass;
}): Promise<CommunicationPolicyResult> {
  const { data, error } = await supabase.rpc('crm_evaluate_communication_policy', {
    p_client_id: input.clientId,
    p_channel: input.channel,
    p_message_class: input.messageClass,
  });
  if (error) {
    return {
      allowed: false,
      requiresReview: false,
      reasons: [error.message],
      suppressionCode: 'policy_check_failed',
    };
  }
  const decision = (data ?? {}) as {
    allowed?: boolean;
    reason_code?: string;
    policy_version?: string;
  };
  const allowed = !!decision.allowed;
  const reason = decision.reason_code ?? (allowed ? 'ok' : 'unknown_canonical_state');
  return {
    allowed,
    requiresReview: false,
    reasons: allowed ? [] : [reason],
    suppressionCode: allowed ? undefined : reason,
  };
}

async function listEmailMessages(filters: { clientId?: string; limit: number }) {
  let query = untypedSupabase
    .from('crm_email_messages')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(filters.limit);
  if (filters.clientId) query = query.eq('client_id', filters.clientId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CrmEmailMessageRow[];
}

export const supabaseCommunicationsRepository: CommunicationsRepository = {
  async listForClient(clientId) {
    const tenantId = await tenantForClient(clientId);
    const [inbound, bulk, emailRows, internal] = await Promise.all([
      supabase
        .from('crm_inbound_sms_logs')
        .select('*')
        .eq('client_id', clientId)
        .order('received_at', { ascending: false })
        .limit(200),
      supabase
        .from('crm_bulk_sms_recipients')
        .select('*')
        .eq('client_id', clientId)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .limit(200),
      listEmailMessages({ clientId, limit: 400 }),
      supabase
        .from('crm_notes')
        .select('*')
        .eq('client_id', clientId)
        .eq('note_type', 'internal')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    const out: CommunicationMessage[] = [
      ...(inbound.data ?? []).map((row) => rowInboundSms(row, tenantId)),
      ...(bulk.data ?? []).map((row) => rowBulkSms(row, tenantId)),
      ...emailRows.map(rowEmailMessage),
      ...(internal.data ?? []).map(rowCrmNote),
    ];
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async listThreads(channel) {
    if (channel === 'sms') {
      const [inbound, bulk] = await Promise.all([
        supabase
          .from('crm_inbound_sms_logs')
          .select('*')
          .order('received_at', { ascending: false })
          .limit(500),
        supabase
          .from('crm_bulk_sms_recipients')
          .select('*')
          .order('sent_at', { ascending: false, nullsFirst: false })
          .limit(500),
      ]);
      const all = [
        ...(inbound.data ?? []).map((row) => rowInboundSms(row, row.tenant_id ?? '')),
        ...(bulk.data ?? []).map((row) => rowBulkSms(row, row.tenant_id)),
      ];
      const byThread = new Map<string, CommunicationMessage>();
      for (const message of all) {
        const existing = byThread.get(message.threadId);
        if (!existing || existing.createdAt < message.createdAt) {
          byThread.set(message.threadId, message);
        }
      }
      return Array.from(byThread.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const messages = (await listEmailMessages({ limit: 500 })).map(rowEmailMessage);
    const byThread = new Map<string, CommunicationMessage>();
    for (const message of messages) {
      const existing = byThread.get(message.threadId);
      if (!existing || existing.createdAt < message.createdAt) {
        byThread.set(message.threadId, message);
      }
    }
    return Array.from(byThread.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async send(message) {
    if (message.channel === 'sms') {
      if (!message.clientId) throw new Error('clientId is required for SMS send');
      const { data, error } = await supabase.functions.invoke('crm-send-client-sms', {
        body: {
          clientId: message.clientId,
          body: message.body,
          campaignId: message.campaignId,
          messageClass: 'necessary_scheduling',
        },
      });
      if (error) throw new Error(error.message);
      if (data && typeof data === 'object' && 'error' in data) {
        throw new Error(String((data as { error: string }).error));
      }
      return {
        ...message,
        id: `sms-${Date.now()}`,
        createdAt: (data as { sentAt?: string } | null)?.sentAt ?? new Date().toISOString(),
        status: 'sent',
      };
    }

    if (message.channel === 'email') {
      if (!message.clientId) throw new Error('clientId is required for email send');
      if (!message.subject) throw new Error('subject is required for email send');

      const client = await supabaseClientsRepository.get(message.clientId);
      if (!client) throw new Error('Client not found');
      if (!client.email) {
        return {
          ...message,
          id: `email-${Date.now()}`,
          createdAt: new Date().toISOString(),
          status: 'failed',
          suppressionReason: 'INVALID_EMAIL',
        };
      }

      const messageClass =
        message.messageClass ??
        (message.campaignId ? 'ordinary_campaign_follow_up' : 'necessary_scheduling');
      const policy = await evaluateCommunicationPolicy({
        clientId: message.clientId,
        channel: 'email',
        messageClass,
      });
      if (!policy.allowed) {
        return {
          ...message,
          to: client.email,
          id: `email-${Date.now()}`,
          createdAt: new Date().toISOString(),
          status: 'suppressed',
          suppressionReason: policy.suppressionCode ?? policy.reasons.join('; '),
        };
      }

      try {
        const result = await resendEmailApi<{ message: CrmEmailMessageRow }>('send', {
          method: 'POST',
          body: {
            tenantId: client.tenantId,
            clientId: message.clientId,
            subject: message.subject,
            text: message.body,
            campaignId: message.campaignId ?? null,
            messageClass,
          },
        });
        return rowEmailMessage(result.message);
      } catch (error) {
        return {
          ...message,
          to: client.email,
          id: `email-${Date.now()}`,
          createdAt: new Date().toISOString(),
          status: 'failed',
          suppressionReason: error instanceof Error ? error.message : 'PROVIDER_FAILURE',
        };
      }
    }

    if (!message.clientId) throw new Error('clientId is required for internal note');
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw new Error('Not authenticated');

    const { data: clientRow, error: clientError } = await supabase
      .from('clients')
      .select('tenant_id')
      .eq('id', message.clientId)
      .maybeSingle();
    if (clientError) throw new Error(clientError.message);
    if (!clientRow?.tenant_id) throw new Error('Client not found');

    const { data, error } = await supabase
      .from('crm_notes')
      .insert({
        tenant_id: clientRow.tenant_id,
        client_id: message.clientId,
        created_by_profile_id: user.id,
        note_type: 'internal',
        note_content: message.body,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return rowCrmNote(data);
  },

  async evaluatePolicy({ clientId, channel, messageClass }): Promise<CommunicationPolicyResult> {
    return evaluateCommunicationPolicy({ clientId, channel, messageClass });
  },

  async ingestInbound(message) {
    return {
      ...message,
      id: `ingest-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'received',
    };
  },
};
