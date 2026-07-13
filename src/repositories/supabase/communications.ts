import { supabase } from '@/integrations/supabase/client';
import type { CommunicationsRepository } from '../types';
import type { CommunicationMessage, CommunicationPolicyResult } from '@/domain/operations';
import { supabaseClientsRepository } from './clients';

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

type Row = Record<string, any>;

function rowInboundSms(r: Row, tenantId: string): CommunicationMessage {
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

function rowBulkSms(r: Row, tenantId: string): CommunicationMessage {
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

function rowEmailThread(link: Row, cache: Row | undefined, tenantId: string): CommunicationMessage {
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

function rowInternal(r: Row): CommunicationMessage {
  return {
    id: `msg-${r.id}`,
    tenantId: r.tenant_id,
    clientId: r.client_id,
    channel: 'note',
    direction: r.sender_type === 'client' ? 'inbound' : 'outbound',
    from: r.sender_id,
    to: r.sender_type === 'client' ? r.staff_id : r.client_id,
    body: r.body,
    status: 'delivered',
    threadId: `note:${r.client_id}`,
    createdAt: r.created_at,
  };
}

async function tenantForClient(clientId: string): Promise<string> {
  const { data } = await (supabase as any)
    .from('clients').select('tenant_id').eq('id', clientId).maybeSingle();
  return data?.tenant_id ?? '';
}

export const supabaseCommunicationsRepository: CommunicationsRepository = {
  async listForClient(clientId) {
    const tenantId = await tenantForClient(clientId);
    const [inbound, bulk, links, internal] = await Promise.all([
      (supabase as any)
        .from('crm_inbound_sms_logs')
        .select('*').eq('client_id', clientId)
        .order('received_at', { ascending: false }).limit(200),
      (supabase as any)
        .from('crm_bulk_sms_recipients')
        .select('*').eq('client_id', clientId)
        .order('sent_at', { ascending: false, nullsFirst: false }).limit(200),
      (supabase as any)
        .from('crm_conversation_links')
        .select('*').eq('client_id', clientId).limit(200),
      (supabase as any)
        .from('messages')
        .select('*').eq('client_id', clientId)
        .order('created_at', { ascending: false }).limit(200),
    ]);

    const convoIds = (links.data ?? []).map((l: Row) => l.helpscout_conversation_id);
    let cacheById = new Map<string, Row>();
    if (convoIds.length) {
      const { data: cacheRows } = await (supabase as any)
        .from('crm_conversation_cache').select('*').in('helpscout_conversation_id', convoIds);
      cacheById = new Map((cacheRows ?? []).map((c: Row) => [c.helpscout_conversation_id, c]));
    }

    const out: CommunicationMessage[] = [
      ...(inbound.data ?? []).map((r: Row) => rowInboundSms(r, tenantId)),
      ...(bulk.data ?? []).map((r: Row) => rowBulkSms(r, tenantId)),
      ...(links.data ?? []).map((r: Row) => rowEmailThread(r, cacheById.get(r.helpscout_conversation_id), tenantId)),
      ...(internal.data ?? []).map((r: Row) => rowInternal(r)),
    ];
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async listThreads(channel) {
    if (channel === 'sms') {
      const [inbound, bulk] = await Promise.all([
        (supabase as any)
          .from('crm_inbound_sms_logs')
          .select('*').order('received_at', { ascending: false }).limit(500),
        (supabase as any)
          .from('crm_bulk_sms_recipients')
          .select('*').order('sent_at', { ascending: false, nullsFirst: false }).limit(500),
      ]);
      const all = [
        ...(inbound.data ?? []).map((r: Row) => rowInboundSms(r, r.tenant_id ?? '')),
        ...(bulk.data ?? []).map((r: Row) => rowBulkSms(r, r.tenant_id ?? '')),
      ];
      const byThread = new Map<string, CommunicationMessage>();
      for (const m of all) {
        const existing = byThread.get(m.threadId);
        if (!existing || existing.createdAt < m.createdAt) byThread.set(m.threadId, m);
      }
      return Array.from(byThread.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    // email
    const { data } = await (supabase as any)
      .from('crm_conversation_cache')
      .select('*')
      .order('last_thread_at', { ascending: false, nullsFirst: false })
      .limit(500);
    return (data ?? []).map((c: Row) => ({
      id: `email-${c.helpscout_conversation_id}`,
      tenantId: c.tenant_id,
      channel: 'email' as const,
      direction: (c.needs_reply ? 'inbound' : 'outbound') as CommunicationMessage['direction'],
      from: c.customer_email ?? '',
      to: c.customer_email ?? '',
      subject: c.subject ?? undefined,
      body: c.preview_text ?? '',
      status: 'delivered' as const,
      threadId: `email:${c.helpscout_conversation_id}`,
      createdAt: c.last_thread_at ?? c.cached_at,
    }));
  },

  async send(msg) {
    // Delegate to the existing delivery edge functions. The frontend already
    // uses these directly; this adapter path exists so callers routed through
    // the CrmDataProvider can send without knowing the transport.
    if (msg.channel === 'sms') {
      const { data, error } = await supabase.functions.invoke('ringcentral-sms', {
        body: { clientId: msg.clientId, body: msg.body, campaignId: msg.campaignId },
      });
      if (error) throw new Error(error.message);
      return {
        ...msg,
        id: (data as any)?.id ?? `sms-${Date.now()}`,
        createdAt: new Date().toISOString(),
        status: 'sent',
      };
    }
    if (msg.channel === 'email') {
      const { data, error } = await supabase.functions.invoke('helpscout-proxy', {
        body: {
          action: 'sendEmail',
          clientId: msg.clientId,
          subject: msg.subject,
          body: msg.body,
          campaignId: msg.campaignId,
        },
      });
      if (error) throw new Error(error.message);
      return {
        ...msg,
        id: (data as any)?.id ?? `email-${Date.now()}`,
        createdAt: new Date().toISOString(),
        status: 'sent',
      };
    }
    // Internal note
    const { data, error } = await (supabase as any).from('messages').insert({
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
