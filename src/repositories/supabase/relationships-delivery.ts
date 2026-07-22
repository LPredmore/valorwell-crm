import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilityState } from '@/domain/relationships/capabilities';
import type { CapabilityAvailability, CapabilityStatus } from '@/domain/relationships/contracts';
import type {
  RelationshipCampaignExecutionResult,
  RelationshipCommunication,
  RelationshipCommunicationEvent,
  RelationshipDeliveryReadiness,
  RelationshipReply,
  RelationshipReplyStatus,
} from '@/domain/relationships/delivery-contracts';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { RelationshipsRepository } from '@/repositories/relationships';
import { supabaseRelationshipsRepository as safetyRelationshipsRepository } from './relationships-safety';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type OperatingContext = { tenantId: string; canMutate: boolean };
type JsonObject = { [key: string]: Json | undefined };

type CommunicationRow = {
  id: string; work_item_id: string | null; campaign_id: string | null; campaign_step_id: string | null;
  enrollment_id: string | null; organization_id: string | null; contact_id: string | null; opportunity_id: string | null;
  direction: string; channel: string; status: string; sender_email: string; recipient_email: string; subject: string | null;
  rendered_body: string | null; provider: string | null; provider_message_id: string | null; provider_thread_id: string | null;
  occurred_at: string; scheduled_for: string | null; sent_at: string | null; delivered_at: string | null; failed_at: string | null;
  error_code: string | null; error_message: string | null; metadata: Json; created_by_profile_id: string | null;
  updated_by_profile_id: string | null; created_at: string; updated_at: string;
};

type CommunicationEventRow = {
  id: string; communication_id: string; provider: string; provider_event_id: string | null; event_type: string;
  occurred_at: string; payload: Json; created_at: string;
};

type ReplyRow = {
  id: string; communication_id: string; enrollment_id: string | null; organization_id: string | null; contact_id: string | null;
  opportunity_id: string | null; owner_profile_id: string | null; status: string; follow_up_due_at: string | null;
  resolved_at: string | null; version: number; metadata: Json; created_by_profile_id: string | null;
  updated_by_profile_id: string | null; created_at: string; updated_at: string;
  relationship_communications: CommunicationRow | null;
};

type DeliveryDatabase = {
  public: {
    Tables: {
      relationship_communications: { Row: CommunicationRow; Insert: never; Update: never; Relationships: [] };
      relationship_communication_events: { Row: CommunicationEventRow; Insert: never; Update: never; Relationships: [] };
      relationship_replies: { Row: Omit<ReplyRow, 'relationship_communications'>; Insert: never; Update: never; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      get_relationship_delivery_readiness: { Args: { p_campaign_id: string }; Returns: Json };
      set_relationship_campaign_execution: { Args: { p_campaign_id: string; p_expected_version: number; p_enabled: boolean; p_idempotency_key: string; p_reason?: string | null }; Returns: Json };
      update_relationship_reply: { Args: { p_reply_id: string; p_expected_version: number; p_status?: string | null; p_owner_profile_id?: string | null; p_follow_up_due_at?: string | null; p_idempotency_key?: string | null; p_reason?: string | null }; Returns: Json };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const deliverySupabase = supabase as unknown as SupabaseClient<DeliveryDatabase>;

function isObject(value: Json | undefined): value is JsonObject { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function record(value: Json | undefined): Record<string, unknown> { return isObject(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: Json | undefined) { return typeof value === 'string' && value ? value : undefined; }
function requiredString(value: Json | undefined, label: string) { const result = stringValue(value); if (!result) throw new Error(`Invalid relationship ${label}.`); return result; }
function booleanValue(value: Json | undefined, fallback = false) { return typeof value === 'boolean' ? value : fallback; }
function numberValue(value: Json | undefined, fallback = 0) { return typeof value === 'number' ? value : fallback; }
function stringArray(value: Json | undefined) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function newKey(prefix: string) { return `${prefix}:${crypto.randomUUID()}`; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function capabilityStatus(error: unknown): CapabilityStatus {
  const message = errorMessage(error).toLowerCase();
  if (message.includes('permission') || message.includes('authorized') || message.includes('42501')) return 'permission_denied';
  if (message.includes('fetch') || message.includes('network')) return 'network_error';
  if (message.includes('invalid')) return 'invalid_response';
  return 'query_error';
}
function replaceCapability(items: CapabilityAvailability[], replacement: CapabilityAvailability) {
  const index = items.findIndex((item) => item.capability === replacement.capability);
  if (index >= 0) items[index] = replacement;
  return items;
}
async function operatingContext(): Promise<OperatingContext> {
  const { data, error } = await supabase.rpc('get_crm_operating_context');
  if (error) throw new Error(error.message);
  if (!isObject(data)) throw new Error('Invalid CRM operating context response.');
  const tenantId = data.current_tenant_id;
  if (data.authenticated !== true || typeof tenantId !== 'string' || !tenantId) throw new Error('Authenticated CRM tenant access is required.');
  const capabilities = data.capabilities;
  return { tenantId, canMutate: isObject(capabilities) && capabilities.mutate === true };
}
function requireMutation(context: OperatingContext) { if (!context.canMutate) throw new Error('You do not have permission to manage relationship delivery or replies.'); }
function paging(page?: number, pageSize?: number) {
  const safePage = Number.isInteger(page) && (page ?? 0) > 0 ? page! : 1;
  const safeSize = Math.min(Number.isInteger(pageSize) && (pageSize ?? 0) > 0 ? pageSize! : DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  return { page: safePage, pageSize: safeSize, from: (safePage - 1) * safeSize, to: safePage * safeSize - 1 };
}

function mapCommunication(row: CommunicationRow): RelationshipCommunication {
  return {
    id: row.id, workItemId: row.work_item_id ?? undefined, campaignId: row.campaign_id ?? undefined,
    campaignStepId: row.campaign_step_id ?? undefined, enrollmentId: row.enrollment_id ?? undefined,
    organizationId: row.organization_id ?? undefined, contactId: row.contact_id ?? undefined, opportunityId: row.opportunity_id ?? undefined,
    direction: row.direction as RelationshipCommunication['direction'], channel: 'email', status: row.status as RelationshipCommunication['status'],
    senderEmail: row.sender_email, recipientEmail: row.recipient_email, subject: row.subject ?? undefined,
    renderedBody: row.rendered_body ?? undefined, provider: row.provider === 'resend' ? 'resend' : undefined,
    providerMessageId: row.provider_message_id ?? undefined, providerThreadId: row.provider_thread_id ?? undefined,
    occurredAt: row.occurred_at, scheduledFor: row.scheduled_for ?? undefined, sentAt: row.sent_at ?? undefined,
    deliveredAt: row.delivered_at ?? undefined, failedAt: row.failed_at ?? undefined, errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined, metadata: record(row.metadata), createdAt: row.created_at, updatedAt: row.updated_at,
    createdBy: row.created_by_profile_id ?? undefined, updatedBy: row.updated_by_profile_id ?? undefined,
  };
}
function mapEvent(row: CommunicationEventRow): RelationshipCommunicationEvent {
  return { id: row.id, communicationId: row.communication_id, provider: row.provider, providerEventId: row.provider_event_id ?? undefined, eventType: row.event_type, occurredAt: row.occurred_at, payload: record(row.payload), createdAt: row.created_at };
}
function mapReply(row: ReplyRow): RelationshipReply {
  const communication = row.relationship_communications;
  if (!communication) throw new Error('Relationship reply is missing its canonical inbound communication.');
  return {
    id: row.id, communicationLogId: row.communication_id, enrollmentId: row.enrollment_id ?? undefined,
    organizationId: row.organization_id ?? undefined, contactId: row.contact_id ?? undefined, opportunityId: row.opportunity_id ?? undefined,
    ownerId: row.owner_profile_id ?? undefined, receivedAt: communication.occurred_at, senderEmail: communication.sender_email,
    recipientEmail: communication.recipient_email, subject: communication.subject ?? undefined, body: communication.rendered_body ?? '',
    status: row.status as RelationshipReplyStatus, followUpDueAt: row.follow_up_due_at ?? undefined, resolvedAt: row.resolved_at ?? undefined,
    version: row.version, metadata: record(row.metadata), createdAt: row.created_at, updatedAt: row.updated_at,
    createdBy: row.created_by_profile_id ?? undefined, updatedBy: row.updated_by_profile_id ?? undefined,
  };
}
function mapReplyResponse(value: Json): RelationshipReply {
  if (!isObject(value)) throw new Error('Invalid relationship reply response.');
  return {
    id: requiredString(value.id, 'reply id'), communicationLogId: requiredString(value.communicationLogId, 'reply communication id'),
    enrollmentId: stringValue(value.enrollmentId), organizationId: stringValue(value.organizationId), contactId: stringValue(value.contactId),
    opportunityId: stringValue(value.opportunityId), ownerId: stringValue(value.ownerId), receivedAt: requiredString(value.receivedAt, 'reply received timestamp'),
    senderEmail: requiredString(value.senderEmail, 'reply sender'), recipientEmail: requiredString(value.recipientEmail, 'reply recipient'),
    subject: stringValue(value.subject), body: stringValue(value.body) ?? '', status: requiredString(value.status, 'reply status') as RelationshipReplyStatus,
    followUpDueAt: stringValue(value.followUpDueAt), resolvedAt: stringValue(value.resolvedAt), version: numberValue(value.version, 1),
    metadata: record(value.metadata), createdAt: requiredString(value.createdAt, 'reply created timestamp'), updatedAt: requiredString(value.updatedAt, 'reply updated timestamp'),
    createdBy: stringValue(value.createdBy), updatedBy: stringValue(value.updatedBy),
  };
}
function mapReadiness(value: Json): RelationshipDeliveryReadiness {
  if (!isObject(value)) throw new Error('Invalid relationship delivery readiness response.');
  return {
    ready: booleanValue(value.ready), reasons: stringArray(value.reasons), campaignId: requiredString(value.campaignId, 'delivery campaign id'),
    executionEnabled: booleanValue(value.executionEnabled), provider: 'resend',
    providerStatus: (stringValue(value.providerStatus) ?? 'disabled') as RelationshipDeliveryReadiness['providerStatus'],
    senderEmail: stringValue(value.senderEmail), inboundAddress: stringValue(value.inboundAddress), webhookEndpoint: stringValue(value.webhookEndpoint), lastVerifiedAt: stringValue(value.lastVerifiedAt),
  };
}

async function capabilities() {
  const capabilities = await safetyRelationshipsRepository.capabilities();
  try {
    const context = await operatingContext();
    const { error } = await deliverySupabase.from('relationship_replies').select('id').eq('tenant_id', context.tenantId).limit(1);
    replaceCapability(capabilities, error ? capabilityState('replies', capabilityStatus(error), error.message) : capabilityState('replies', 'available'));
  } catch (error) {
    replaceCapability(capabilities, capabilityState('replies', capabilityStatus(error), errorMessage(error)));
  }
  return capabilities;
}

async function listCommunications(subject: Parameters<RelationshipsRepository['listCommunications']>[0]) {
  const context = await operatingContext();
  let query = deliverySupabase.from('relationship_communications').select('*').eq('tenant_id', context.tenantId);
  if (subject.organizationId) query = query.eq('organization_id', subject.organizationId);
  if (subject.contactId) query = query.eq('contact_id', subject.contactId);
  if (subject.opportunityId) query = query.eq('opportunity_id', subject.opportunityId);
  if (subject.enrollmentId) query = query.eq('enrollment_id', subject.enrollmentId);
  const { data, error } = await query.order('occurred_at', { ascending: false }).limit(250);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapCommunication);
}
async function listCommunicationEvents(communicationId: string) {
  const context = await operatingContext();
  const { data, error } = await deliverySupabase.from('relationship_communication_events').select('*').eq('tenant_id', context.tenantId).eq('communication_id', communicationId).order('occurred_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapEvent);
}
async function listReplies(filters: Parameters<RelationshipsRepository['listReplies']>[0] = {}) {
  const context = await operatingContext();
  const values = paging(filters.page, filters.pageSize);
  let query = deliverySupabase.from('relationship_replies').select('*, relationship_communications(*)', { count: 'exact' }).eq('tenant_id', context.tenantId);
  if (filters.statuses?.length) query = query.in('status', filters.statuses);
  if (filters.ownerId) query = query.eq('owner_profile_id', filters.ownerId);
  if (filters.unownedOnly) query = query.is('owner_profile_id', null);
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(values.from, values.to);
  if (error) throw new Error(error.message);
  return { items: ((data ?? []) as unknown as ReplyRow[]).map(mapReply), total: count ?? 0, page: values.page, pageSize: values.pageSize };
}
async function updateReply(id: string, input: Parameters<RelationshipsRepository['updateReply']>[1]) {
  const context = await operatingContext(); requireMutation(context);
  const { data, error } = await deliverySupabase.rpc('update_relationship_reply', {
    p_reply_id: id, p_expected_version: input.expectedVersion, p_status: input.status ?? null,
    p_owner_profile_id: input.ownerId ?? null, p_follow_up_due_at: input.followUpDueAt ?? null,
    p_idempotency_key: input.idempotencyKey?.trim() || newKey('relationship-reply'), p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return mapReplyResponse(data);
}
async function getDeliveryReadiness(campaignId: string) {
  await operatingContext();
  const { data, error } = await deliverySupabase.rpc('get_relationship_delivery_readiness', { p_campaign_id: campaignId });
  if (error) throw new Error(error.message);
  return mapReadiness(data);
}
async function setCampaignExecution(campaignId: string, input: Parameters<RelationshipsRepository['setCampaignExecution']>[1]): Promise<RelationshipCampaignExecutionResult> {
  const context = await operatingContext(); requireMutation(context);
  const { data, error } = await deliverySupabase.rpc('set_relationship_campaign_execution', {
    p_campaign_id: campaignId, p_expected_version: input.expectedVersion, p_enabled: input.enabled,
    p_idempotency_key: input.idempotencyKey?.trim() || newKey('relationship-execution'), p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  if (!isObject(data)) throw new Error('Invalid relationship campaign execution response.');
  return { campaignId: requiredString(data.campaignId, 'execution campaign id'), executionEnabled: booleanValue(data.executionEnabled), version: numberValue(data.version), readiness: mapReadiness(data.readiness as Json) };
}

export const supabaseRelationshipsRepository: RelationshipsRepository = {
  ...safetyRelationshipsRepository,
  capabilities,
  listCommunications,
  listCommunicationEvents,
  listReplies,
  updateReply,
  getDeliveryReadiness,
  setCampaignExecution,
};
