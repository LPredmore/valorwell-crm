import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { CommunicationsRepository } from '../types';
import type { CommunicationMessage, CommunicationPolicyResult } from '@/domain/operations';
import { supabaseClientsRepository } from './clients';
import { displayName } from '@/domain/canonical';

/**
 * Supabase-backed communications adapter.
 *
 * Reads a unified per-client timeline from:
 *   - crm_inbound_sms_logs       (inbound SMS)
 *   - crm_bulk_sms_recipients    (outbound bulk SMS)
 *   - crm_conversation_links     (email thread membership)
 *   - crm_conversation_cache     (email thread metadata / previews)
 *   - messages                   (internal staff↔client notes)
 *
 * Send is delegated to the existing helpscout-proxy / ringcentral-sms
 * edge functions — this adapter does not duplicate their delivery logic.
 */

type BulkSmsRow = Tables<'crm_bulk_sms_recipients'>;
type ConversationCacheRow = Tables<'crm_conversation_cache'>;
type ConversationLinkRow = Tables<'crm_conversation_links'>;
type InboundSmsRow = Tables<'crm_inbound_sms_logs'>;
type CrmNoteRow = Tables<'crm_notes'>;

function rowInboundSms(r: InboundSmsRow, tenantId: string): CommunicationMessage {
  return {
    id: `insms-${r.id}`,
    tenantId,
    clientId: r.client_id ?? undefined,
    channel: 'sms',
    direction: 'inbound',
    from: r.from_phone,
    to: r.to_phone,
    body: r.message_body ?? '',
    status: 'received',
    threadId: `sms:${r.client_id ?? r.from_phone}`,
    createdAt: r.received_at ?? r.created_at,
  };
}

function rowBulkSms(r: BulkSmsRow, tenantId: string): CommunicationMessage {
  const status: CommunicationMessage['status'] =
    r.status === 'sent' ? 'sent' :
    r.status === 'failed' ? 'failed' :
    r.status === 'suppressed' ? 'suppressed' : 'queued';
  return {
    id: `bulksms-${r.id}`,
    tenantId,
    clientId: r.client_id,
    channel: 'sms',
    direction: 'outbound',
    from: 'bulk-sms',
    to: r.client_id,
    body: r.error_message ?? '',
    status,
    suppressionReason: r.status === 'suppressed' ? r.error_message ?? undefined : undefined,
    threadId: `sms:${r.client_id}`,
    createdAt: r.sent_at ?? r.created_at,
  };
}

function rowEmailThread(
  link: ConversationLinkRow,
  cache: ConversationCacheRow | undefined,
  tenantId: string,
): CommunicationMessage {
  return {
    id: `email-${link.helpscout_conversation_id}`,
    tenantId,
    clientId: link.client_id,
    channel: 'email',
    direction: (cache?.needs_reply ? 'inbound' : 'outbound'),
    from: cache?.customer_email ?? '',
    to: cache?.customer_email ?? '',
    subject: cache?.subject ?? undefined,
    body: cache?.preview_text ?? '',
    status: 'delivered',
    threadId: `email:${link.helpscout_conversation_id}`,
    createdAt: cache?.last_thread_at ?? link.linked_at ?? link.created_at,
  };
}

function rowCrmNote(r: CrmNoteRow): CommunicationMessage {
  return {
    id: `note-${r.id}`,
    tenantId: r.tenant_id,
    clientId: r.client_id ?? undefined,
    channel: 'note',
    direction: 'outbound',
    from: r.created_by_profile_id,
    to: r.client_id ?? '',
    body: r.note_content,
    status: 'delivered',
    threadId: `note:${r.client_id ?? r.id}`,
    createdAt: r.created_at,
  };
}

async function tenantForClient(clientId: string): Promise<string> {
  const { data } = await supabase
    .from('clients').select('tenant_id').eq('id', clientId).maybeSingle();
  return data?.tenant_id ?? '';
}

export const supabaseCommunicationsRepository: CommunicationsRepository = {
  async listForClient(clientId) {
    const tenantId = await tenantForClient(clientId);
    const [inbound, bulk, links, internal] = await Promise.all([
      supabase
        .from('crm_inbound_sms_logs')
        .select('*').eq('client_id', clientId)
        .order('received_at', { ascending: false }).limit(200),
      supabase
        .from('crm_bulk_sms_recipients')
        .select('*').eq('client_id', clientId)
        .order('sent_at', { ascending: false, nullsFirst: false }).limit(200),
      supabase
        .from('crm_conversation_links')
        .select('*').eq('client_id', clientId).limit(200),
      supabase
        .from('crm_notes')
        .select('*').eq('client_id', clientId).eq('note_type', 'internal')
        .order('created_at', { ascending: false }).limit(200),
    ]);

    const convoIds = (links.data ?? []).map((link) => link.helpscout_conversation_id);
    let cacheById = new Map<string, ConversationCacheRow>();
    if (convoIds.length) {
      const { data: cacheRows } = await supabase
        .from('crm_conversation_cache').select('*').in('helpscout_conversation_id', convoIds);
      cacheById = new Map((cacheRows ?? []).map((cache) => [cache.helpscout_conversation_id, cache]));
    }

    const out: CommunicationMessage[] = [
      ...(inbound.data ?? []).map((row) => rowInboundSms(row, tenantId)),
      ...(bulk.data ?? []).map((row) => rowBulkSms(row, tenantId)),
      ...(links.data ?? []).map((row) => rowEmailThread(row, cacheById.get(row.helpscout_conversation_id), tenantId)),
      ...(internal.data ?? []).map((row) => rowCrmNote(row)),
    ];
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async listThreads(channel) {
    if (channel === 'sms') {
      const [inbound, bulk] = await Promise.all([
        supabase
          .from('crm_inbound_sms_logs')
          .select('*').order('received_at', { ascending: false }).limit(500),
        supabase
          .from('crm_bulk_sms_recipients')
          .select('*').order('sent_at', { ascending: false, nullsFirst: false }).limit(500),
      ]);
      const all = [
        ...(inbound.data ?? []).map((row) => rowInboundSms(row, row.tenant_id ?? '')),
        ...(bulk.data ?? []).map((row) => rowBulkSms(row, row.tenant_id)),
      ];
      const byThread = new Map<string, CommunicationMessage>();
      for (const m of all) {
        const existing = byThread.get(m.threadId);
        if (!existing || existing.createdAt < m.createdAt) byThread.set(m.threadId, m);
      }
      return Array.from(byThread.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    // email
    const { data } = await supabase
      .from('crm_conversation_cache')
      .select('*')
      .order('last_thread_at', { ascending: false, nullsFirst: false })
      .limit(500);
    return (data ?? []).map((cache) => ({
      id: `email-${cache.helpscout_conversation_id}`,
      tenantId: cache.tenant_id,
      channel: 'email' as const,
      direction: cache.needs_reply ? 'inbound' as const : 'outbound' as const,
      from: cache.customer_email ?? '',
      to: cache.customer_email ?? '',
      subject: cache.subject ?? undefined,
      body: cache.preview_text ?? '',
      status: 'delivered' as const,
      threadId: `email:${cache.helpscout_conversation_id}`,
      createdAt: cache.last_thread_at ?? cache.cached_at,
    }));
  },

  async send(msg) {
    // Delegate to the existing delivery edge functions. The frontend already
    // uses these directly; this adapter path exists so callers routed through
    // the CrmDataProvider can send without knowing the transport.
    if (msg.channel === 'sms') {
      if (!msg.clientId) throw new Error('clientId is required for SMS send');
      const { data, error } = await supabase.functions.invoke('ringcentral-sms', {
        body: {
          action: 'send-individual',
          clientId: msg.clientId,
          body: msg.body,
          campaignId: msg.campaignId,
          messageClass: 'necessary_scheduling',
        },
      });
      if (error) throw new Error(error.message);
      if (data && typeof data === 'object' && 'error' in data) {
        throw new Error(String((data as { error: string }).error));
      }
      return {
        ...msg,
        id: `sms-${Date.now()}`,
        createdAt: (data as { sentAt?: string } | null)?.sentAt ?? new Date().toISOString(),
        status: 'sent',
      };
    }
    if (msg.channel === 'email') {
      if (!msg.clientId) throw new Error('clientId is required for email send');
      if (!msg.subject) throw new Error('subject is required for email send');

      // Recipient email MUST come from canonical client record — operator
      // cannot substitute a different address. msg.to is ignored.
      const client = await supabaseClientsRepository.get(msg.clientId);
      if (!client) throw new Error('Client not found');
      if (!client.email) {
        return { ...msg, id: `email-${Date.now()}`, createdAt: new Date().toISOString(), status: 'failed', suppressionReason: 'INVALID_EMAIL' };
      }

      const messageClass = msg.campaignId ? 'ordinary_campaign_follow_up' : 'manual';

      // Server-side policy evaluation before send.
      const policy = await this.evaluatePolicy({ clientId: msg.clientId, channel: 'email', messageClass });
      if (!policy.allowed) {
        return {
          ...msg,
          id: `email-${Date.now()}`,
          createdAt: new Date().toISOString(),
          status: 'suppressed',
          suppressionReason: policy.suppressionCode ?? policy.reasons.join('; '),
        };
      }

      const { helpscoutApi } = await import('@/lib/crm/helpscout-api');
      const customerName = displayName(client) || undefined;
      let result: { success: boolean; conversationId: string | null };
      try {
        result = await helpscoutApi<{ success: boolean; conversationId: string | null }>(
          'create-conversation',
          {
            method: 'POST',
            body: {
              subject: msg.subject,
              customerEmail: client.email,
              customerName,
              text: msg.body,
              messageClass,
            },
          },
        );
      } catch (e) {
        return {
          ...msg,
          to: client.email,
          id: `email-${Date.now()}`,
          createdAt: new Date().toISOString(),
          status: 'failed',
          suppressionReason: e instanceof Error ? e.message : 'PROVIDER_FAILURE',
        };
      }
      return {
        ...msg,
        to: client.email,
        id: result.conversationId ? `email-${result.conversationId}` : `email-${Date.now()}`,
        createdAt: new Date().toISOString(),
        status: 'sent',
      };
    }
    // Internal note
    const { data, error } = await supabase.from('messages').insert({
      tenant_id: msg.tenantId,
      client_id: msg.clientId,
      staff_id: msg.from,
      sender_id: msg.from,
      sender_type: 'staff',
      body: msg.body,
    }).select('*').single();
    if (error) throw new Error(error.message);
    return rowInternal(data);
  },

  async evaluatePolicy({ clientId, channel, messageClass }): Promise<CommunicationPolicyResult> {
    const c = await supabaseClientsRepository.get(clientId);
    if (!c) return { allowed: false, requiresReview: false, reasons: ['Client not found'] };
    const reasons: string[] = [];
    let code: CommunicationPolicyResult['suppressionCode'] | undefined;
    if (c.contactPolicy === 'Do Not Contact' && messageClass !== 'critical_operational') {
      reasons.push('Client marked Do Not Contact'); code = 'DO_NOT_CONTACT';
    }
    if (c.servicePolicy === 'Service Blocked' && messageClass === 'ordinary_campaign_follow_up') {
      reasons.push('Service Blocked — campaign follow-up not permitted'); code = code ?? 'SERVICE_BLOCKED';
    }
    if (c.lifecycle === 'Closed' && messageClass === 'ordinary_campaign_follow_up') {
      reasons.push('Client is closed'); code = code ?? 'CLIENT_CLOSED';
    }
    if (channel === 'sms' && !c.phone) { reasons.push('No phone on file'); code = code ?? 'CHANNEL_RESTRICTED'; }
    if (channel === 'email' && !c.email) { reasons.push('No email on file'); code = code ?? 'CHANNEL_RESTRICTED'; }
    return { allowed: reasons.length === 0, requiresReview: false, reasons, suppressionCode: code };
  },

  async ingestInbound(msg) {
    // Inbound is persisted by the RingCentral / HelpScout webhook edge
    // functions directly into their canonical tables. This method is a
    // pass-through so the interface remains symmetrical.
    return { ...msg, id: `ingest-${Date.now()}`, createdAt: new Date().toISOString(), status: 'received' };
  },
};
