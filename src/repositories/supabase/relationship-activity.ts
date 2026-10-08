import { supabase } from '@/integrations/supabase/client';
import type { RelationshipCommunication } from '@/domain/relationships/delivery-contracts';

const PER_PAGE = 100;
type Subject = { contactId: string; organizationId?: never } | { organizationId: string; contactId?: never };

/**
 * Paginate the real non-clinical relationship communications table, not the
 * existing list RPC (which silently caps results at 250). The database RLS
 * remains the security boundary, and tenant selection is server-authoritative.
 * Do not read crm_email_messages (clinical-domain email records) here.
 */
export async function listRelationshipEmails(subject: Subject, page: number): Promise<{
  items: RelationshipCommunication[]; total: number;
}> {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid activity page.');
  const { data: context, error: contextError } = await supabase.rpc('get_crm_operating_context');
  if (contextError) throw new Error(contextError.message);
  if (!context || typeof context !== 'object' || Array.isArray(context) ||
      context.authenticated !== true || typeof context.current_tenant_id !== 'string')
    throw new Error('An authorized CRM operating tenant is required.');
  const tenantId = context.current_tenant_id;
  let query = supabase.from('relationship_communications').select(
    'id,contact_id,organization_id,opportunity_id,campaign_id,direction,channel,status,sender_email,recipient_email,subject,provider,provider_message_id,provider_thread_id,occurred_at,sent_at,delivered_at,failed_at,created_at,updated_at',
    { count: 'exact' },
  ).eq('tenant_id', tenantId);
  query = subject.contactId ? query.eq('contact_id',subject.contactId) : query.eq('organization_id', subject.organizationId!);
  const offset = (page-1) * PER_PAGE;
  const { data, error, count } = await query.order('occurred_at',{ascending:false}).range(offset,offset+PER_PAGE-1);
  if(error)throw new Error(error.message);
  return {
    total: count ?? 0,
    items: (data ?? []).map(row => ({
      id: row.id,
      contactId: row.contact_id ?? undefined,
      organizationId: row.organization_id ?? undefined,
      opportunityId: row.opportunity_id ?? undefined,
      campaignId: row.campaign_id ?? undefined,
      channel: 'email',
      direction: row.direction as RelationshipCommunication['direction'],
      status: row.status as RelationshipCommunication['status'],
      senderEmail: row.sender_email ?? '',
      recipientEmail: row.recipient_email ?? '',
      subject: row.subject ?? undefined,
      provider: row.provider === 'resend' ? 'resend' as const : undefined,
      providerMessageId: row.provider_message_id ?? undefined,
      providerThreadId: row.provider_thread_id ?? undefined,
      occurredAt: row.occurred_at,
      sentAt: row.sent_at ?? undefined,
      deliveredAt: row.delivered_at ?? undefined,
      failedAt: row.failed_at ?? undefined,
      metadata: {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}
