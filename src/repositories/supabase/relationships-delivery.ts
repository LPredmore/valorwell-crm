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

type OperatingContext = { tenantId: string; canMutate: boolean };
type JsonObject = { [key: string]: Json | undefined };

type DeliveryDatabase = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      list_relationship_communications: { Args: { p_subject?: Json }; Returns: Json };
      list_relationship_communication_events: { Args: { p_communication_id: string }; Returns: Json };
      list_relationship_replies: { Args: { p_filters?: Json }; Returns: Json };
      get_relationship_delivery_readiness: { Args: { p_campaign_id: string }; Returns: Json };
      set_relationship_campaign_execution: {
        Args: {
          p_campaign_id: string;
          p_expected_version: number;
          p_enabled: boolean;
          p_idempotency_key: string;
          p_reason?: string | null;
        };
        Returns: Json;
      };
      update_relationship_reply: {
        Args: {
          p_reply_id: string;
          p_expected_version: number;
          p_status?: string | null;
          p_owner_profile_id?: string | null;
          p_follow_up_due_at?: string | null;
          p_idempotency_key?: string | null;
          p_reason?: string | null;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const deliverySupabase = supabase as unknown as SupabaseClient<DeliveryDatabase>;

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function record(value: Json | undefined): Record<string, unknown> {
  return isObject(value) ? value as Record<string, unknown> : {};
}
function stringValue(value: Json | undefined) {
  return typeof value === 'string' && value ? value : undefined;
}
function requiredString(value: Json | undefined, label: string) {
  const result = stringValue(value);
  if (!result) throw new Error(`Invalid relationship ${label}.`);
  return result;
}
function booleanValue(value: Json | undefined, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}
function numberValue(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' ? value : fallback;
}
function stringArray(value: Json | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
function newKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
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
  if (data.authenticated !== true || typeof tenantId !== 'string' || !tenantId) {
    throw new Error('Authenticated CRM tenant access is required.');
  }
  const capabilities = data.capabilities;
  return { tenantId, canMutate: isObject(capabilities) && capabilities.mutate === true };
}
function requireMutation(context: OperatingContext) {
  if (!context.canMutate) throw new Error('You do not have permission to manage relationship delivery or replies.');
}

function mapCommunication(value: Json): RelationshipCommunication {
  if (!isObject(value)) throw new Error('Invalid relationship communication response.');
  return {
    id: requiredString(value.id, 'communication id'),
    workItemId: stringValue(value.workItemId),
    campaignId: stringValue(value.campaignId),
    campaignStepId: stringValue(value.campaignStepId),
    enrollmentId: stringValue(value.enrollmentId),
    organizationId: stringValue(value.organizationId),
    contactId: stringValue(value.contactId),
    opportunityId: stringValue(value.opportunityId),
    direction: requiredString(value.direction, 'communication direction') as RelationshipCommunication['direction'],
    channel: 'email',
    status: requiredString(value.status, 'communication status') as RelationshipCommunication['status'],
    senderEmail: requiredString(value.senderEmail, 'communication sender'),
    recipientEmail: requiredString(value.recipientEmail, 'communication recipient'),
    subject: stringValue(value.subject),
    renderedBody: stringValue(value.renderedBody),
    provider: stringValue(value.provider) === 'resend' ? 'resend' : undefined,
    providerMessageId: stringValue(value.providerMessageId),
    providerThreadId: stringValue(value.providerThreadId),
    occurredAt: requiredString(value.occurredAt, 'communication timestamp'),
    scheduledFor: stringValue(value.scheduledFor),
    sentAt: stringValue(value.sentAt),
    deliveredAt: stringValue(value.deliveredAt),
    failedAt: stringValue(value.failedAt),
    errorCode: stringValue(value.errorCode),
    errorMessage: stringValue(value.errorMessage),
    metadata: record(value.metadata),
    createdAt: requiredString(value.createdAt, 'communication created timestamp'),
    updatedAt: requiredString(value.updatedAt, 'communication updated timestamp'),
    createdBy: stringValue(value.createdBy),
    updatedBy: stringValue(value.updatedBy),
  };
}
function mapEvent(value: Json): RelationshipCommunicationEvent {
  if (!isObject(value)) throw new Error('Invalid relationship communication event response.');
  return {
    id: requiredString(value.id, 'communication event id'),
    communicationId: requiredString(value.communicationId, 'communication event subject'),
    provider: requiredString(value.provider, 'communication event provider'),
    providerEventId: stringValue(value.providerEventId),
    eventType: requiredString(value.eventType, 'communication event type'),
    occurredAt: requiredString(value.occurredAt, 'communication event timestamp'),
    payload: record(value.payload),
    createdAt: requiredString(value.createdAt, 'communication event created timestamp'),
  };
}
function mapReply(value: Json): RelationshipReply {
  if (!isObject(value)) throw new Error('Invalid relationship reply response.');
  return {
    id: requiredString(value.id, 'reply id'),
    communicationLogId: requiredString(value.communicationLogId, 'reply communication id'),
    enrollmentId: stringValue(value.enrollmentId),
    organizationId: stringValue(value.organizationId),
    contactId: stringValue(value.contactId),
    opportunityId: stringValue(value.opportunityId),
    ownerId: stringValue(value.ownerId),
    receivedAt: requiredString(value.receivedAt, 'reply received timestamp'),
    senderEmail: requiredString(value.senderEmail, 'reply sender'),
    recipientEmail: requiredString(value.recipientEmail, 'reply recipient'),
    subject: stringValue(value.subject),
    body: stringValue(value.body) ?? '',
    status: requiredString(value.status, 'reply status') as RelationshipReplyStatus,
    followUpDueAt: stringValue(value.followUpDueAt),
    resolvedAt: stringValue(value.resolvedAt),
    version: numberValue(value.version, 1),
    metadata: record(value.metadata),
    createdAt: requiredString(value.createdAt, 'reply created timestamp'),
    updatedAt: requiredString(value.updatedAt, 'reply updated timestamp'),
    createdBy: stringValue(value.createdBy),
    updatedBy: stringValue(value.updatedBy),
  };
}
function mapReadiness(value: Json): RelationshipDeliveryReadiness {
  if (!isObject(value)) throw new Error('Invalid relationship delivery readiness response.');
  return {
    ready: booleanValue(value.ready),
    reasons: stringArray(value.reasons),
    campaignId: requiredString(value.campaignId, 'delivery campaign id'),
    executionEnabled: booleanValue(value.executionEnabled),
    provider: 'resend',
    providerStatus: (stringValue(value.providerStatus) ?? 'disabled') as RelationshipDeliveryReadiness['providerStatus'],
    senderEmail: stringValue(value.senderEmail),
    inboundAddress: stringValue(value.inboundAddress),
    webhookEndpoint: stringValue(value.webhookEndpoint),
    lastVerifiedAt: stringValue(value.lastVerifiedAt),
  };
}

async function capabilities() {
  const capabilities = await safetyRelationshipsRepository.capabilities();
  try {
    await operatingContext();
    const { error } = await deliverySupabase.rpc('list_relationship_replies', {
      p_filters: { page: 1, pageSize: 1 },
    });
    replaceCapability(
      capabilities,
      error ? capabilityState('replies', capabilityStatus(error), error.message) : capabilityState('replies', 'available'),
    );
  } catch (error) {
    replaceCapability(capabilities, capabilityState('replies', capabilityStatus(error), errorMessage(error)));
  }
  return capabilities;
}
async function listCommunications(subject: Parameters<RelationshipsRepository['listCommunications']>[0]) {
  await operatingContext();
  const { data, error } = await deliverySupabase.rpc('list_relationship_communications', {
    p_subject: subject as unknown as Json,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('Invalid relationship communication list response.');
  return data.map(mapCommunication);
}
async function listCommunicationEvents(communicationId: string) {
  await operatingContext();
  const { data, error } = await deliverySupabase.rpc('list_relationship_communication_events', {
    p_communication_id: communicationId,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('Invalid relationship communication event list response.');
  return data.map(mapEvent);
}
async function listReplies(filters: Parameters<RelationshipsRepository['listReplies']>[0] = {}) {
  await operatingContext();
  const { data, error } = await deliverySupabase.rpc('list_relationship_replies', {
    p_filters: filters as unknown as Json,
  });
  if (error) throw new Error(error.message);
  if (!isObject(data) || !Array.isArray(data.items)) throw new Error('Invalid relationship reply list response.');
  return {
    items: data.items.map(mapReply),
    total: numberValue(data.total),
    page: numberValue(data.page, 1),
    pageSize: numberValue(data.pageSize, 25),
  };
}
async function updateReply(id: string, input: Parameters<RelationshipsRepository['updateReply']>[1]) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await deliverySupabase.rpc('update_relationship_reply', {
    p_reply_id: id,
    p_expected_version: input.expectedVersion,
    p_status: input.status ?? null,
    p_owner_profile_id: input.ownerId ?? null,
    p_follow_up_due_at: input.followUpDueAt ?? null,
    p_idempotency_key: input.idempotencyKey?.trim() || newKey('relationship-reply'),
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return mapReply(data);
}
async function getDeliveryReadiness(campaignId: string) {
  await operatingContext();
  const { data, error } = await deliverySupabase.rpc('get_relationship_delivery_readiness', {
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(error.message);
  return mapReadiness(data);
}
async function setCampaignExecution(
  campaignId: string,
  input: Parameters<RelationshipsRepository['setCampaignExecution']>[1],
): Promise<RelationshipCampaignExecutionResult> {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await deliverySupabase.rpc('set_relationship_campaign_execution', {
    p_campaign_id: campaignId,
    p_expected_version: input.expectedVersion,
    p_enabled: input.enabled,
    p_idempotency_key: input.idempotencyKey?.trim() || newKey('relationship-execution'),
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  if (!isObject(data)) throw new Error('Invalid relationship campaign execution response.');
  return {
    campaignId: requiredString(data.campaignId, 'execution campaign id'),
    executionEnabled: booleanValue(data.executionEnabled),
    version: numberValue(data.version),
    readiness: mapReadiness(data.readiness ?? {}),
  };
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
