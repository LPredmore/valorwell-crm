import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilityState } from '@/domain/relationships/capabilities';
import type { CapabilityAvailability, CapabilityStatus } from '@/domain/relationships/contracts';
import type {
  RelationshipSuppression,
  RelationshipSuppressionReason,
  RelationshipSuppressionScope,
  RelationshipUnsubscribeOutcome,
  RelationshipUnsubscribeRequest,
} from '@/domain/relationships/safety-contracts';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { RelationshipsRepository } from '@/repositories/relationships';
import { mapRelationshipEnrollmentResponse, mapRelationshipSafetyEvaluation } from './relationships-enrollment-mappers';
import { supabaseRelationshipsRepository as enrollmentRelationshipsRepository } from './relationships-enrollments';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type OperatingContext = { tenantId: string; canMutate: boolean };

type RelationshipSuppressionRow = {
  id: string;
  tenant_id: string;
  scope: string;
  reason: string;
  organization_id: string | null;
  contact_id: string | null;
  campaign_id: string | null;
  email: string | null;
  effective_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by_profile_id: string | null;
  version: number;
  source: string;
  source_record_key: string | null;
  metadata: Json;
  created_by_profile_id: string | null;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

type RelationshipUnsubscribeRequestRow = {
  id: string;
  tenant_id: string | null;
  token_id: string | null;
  email: string | null;
  processed_at: string | null;
  suppression_id: string | null;
  outcome: string;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

type RelationshipSafetyDatabase = {
  public: {
    Tables: {
      relationship_suppressions: {
        Row: RelationshipSuppressionRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      relationship_unsubscribe_requests: {
        Row: RelationshipUnsubscribeRequestRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      apply_relationship_suppression: {
        Args: { p_payload: Json; p_idempotency_key: string };
        Returns: Json;
      };
      revoke_relationship_suppression: {
        Args: { p_suppression_id: string; p_expected_version: number; p_idempotency_key: string; p_reason?: string | null };
        Returns: Json;
      };
      evaluate_relationship_enrollment_safety: {
        Args: { p_enrollment_id: string };
        Returns: Json;
      };
      revalidate_relationship_enrollment_safety: {
        Args: { p_enrollment_id: string; p_expected_version: number; p_idempotency_key: string; p_reason?: string | null };
        Returns: Json;
      };
      process_relationship_unsubscribe: {
        Args: { p_token: string };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const safetySupabase = supabase as unknown as SupabaseClient<RelationshipSafetyDatabase>;
type JsonObject = { [key: string]: Json | undefined };

function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function capabilityStatusFromError(error: unknown): CapabilityStatus {
  const message = errorMessage(error).toLowerCase();
  if (message.includes('permission') || message.includes('not authorized') || message.includes('row-level security') || message.includes('operating tenant') || message.includes('authenticated') || message.includes('42501')) return 'permission_denied';
  if (message.includes('fetch') || message.includes('network') || message.includes('offline')) return 'network_error';
  if (message.includes('invalid') || message.includes('malformed')) return 'invalid_response';
  return 'query_error';
}

async function operatingContext(): Promise<OperatingContext> {
  const { data, error } = await supabase.rpc('get_crm_operating_context');
  if (error) throw new Error(error.message);
  if (!isJsonObject(data)) throw new Error('Invalid CRM operating context response.');
  if (data.authenticated !== true) throw new Error('Authenticated CRM access is required.');
  const tenantId = data.current_tenant_id;
  const capabilities = data.capabilities;
  if (typeof tenantId !== 'string' || !tenantId) throw new Error('No operating tenant is selected for this CRM session.');
  return { tenantId, canMutate: isJsonObject(capabilities) && capabilities.mutate === true };
}

function requireMutation(context: OperatingContext) {
  if (!context.canMutate) throw new Error('You do not have permission to manage relationship communication safety.');
}

function replaceCapability(capabilities: CapabilityAvailability[], replacement: CapabilityAvailability) {
  const index = capabilities.findIndex((item) => item.capability === replacement.capability);
  if (index >= 0) capabilities[index] = replacement;
  return capabilities;
}

function pageValues(page?: number, pageSize?: number) {
  const safePage = Number.isInteger(page) && (page ?? 0) > 0 ? page! : 1;
  const requested = Number.isInteger(pageSize) && (pageSize ?? 0) > 0 ? pageSize! : DEFAULT_PAGE_SIZE;
  const safePageSize = Math.min(requested, MAX_PAGE_SIZE);
  const from = (safePage - 1) * safePageSize;
  return { page: safePage, pageSize: safePageSize, from, to: from + safePageSize - 1 };
}

function newIdempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function record(value: Json | undefined): Record<string, unknown> {
  return isJsonObject(value) ? value as Record<string, unknown> : {};
}

function mapSuppressionRow(row: RelationshipSuppressionRow): RelationshipSuppression {
  return {
    id: row.id,
    scope: row.scope as RelationshipSuppressionScope,
    reason: row.reason as RelationshipSuppressionReason,
    organizationId: row.organization_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    campaignId: row.campaign_id ?? undefined,
    email: row.email ?? undefined,
    effectiveAt: row.effective_at,
    expiresAt: row.expires_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    revokedBy: row.revoked_by_profile_id ?? undefined,
    version: row.version,
    source: row.source,
    metadata: record(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by_profile_id ?? undefined,
    updatedBy: row.updated_by_profile_id ?? undefined,
  };
}

function stringValue(value: Json | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function requiredString(value: Json | undefined, label: string) {
  const result = stringValue(value);
  if (!result) throw new Error(`Invalid relationship ${label}.`);
  return result;
}

function mapSuppressionResponse(value: Json): RelationshipSuppression {
  if (!isJsonObject(value)) throw new Error('Invalid relationship suppression response.');
  return {
    id: requiredString(value.id, 'suppression id'),
    scope: requiredString(value.scope, 'suppression scope') as RelationshipSuppressionScope,
    reason: requiredString(value.reason, 'suppression reason') as RelationshipSuppressionReason,
    organizationId: stringValue(value.organizationId),
    contactId: stringValue(value.contactId),
    campaignId: stringValue(value.campaignId),
    email: stringValue(value.email),
    effectiveAt: requiredString(value.effectiveAt, 'suppression effective timestamp'),
    expiresAt: stringValue(value.expiresAt),
    revokedAt: stringValue(value.revokedAt),
    revokedBy: stringValue(value.revokedBy),
    version: typeof value.version === 'number' ? value.version : 1,
    source: requiredString(value.source, 'suppression source'),
    metadata: record(value.metadata),
    createdAt: requiredString(value.createdAt, 'suppression created timestamp'),
    updatedAt: requiredString(value.updatedAt, 'suppression updated timestamp'),
    createdBy: stringValue(value.createdBy),
    updatedBy: stringValue(value.updatedBy),
  };
}

function mapUnsubscribeResponse(value: Json): RelationshipUnsubscribeRequest {
  if (!isJsonObject(value)) throw new Error('Invalid relationship unsubscribe response.');
  return {
    id: requiredString(value.id, 'unsubscribe request id'),
    tokenId: stringValue(value.tokenId),
    email: stringValue(value.email),
    processedAt: stringValue(value.processedAt),
    suppressionId: stringValue(value.suppressionId),
    outcome: requiredString(value.outcome, 'unsubscribe outcome') as RelationshipUnsubscribeOutcome,
    createdAt: requiredString(value.createdAt, 'unsubscribe created timestamp'),
    updatedAt: requiredString(value.updatedAt, 'unsubscribe updated timestamp'),
  };
}

async function safetyCapabilities(): Promise<CapabilityAvailability[]> {
  const capabilities = await enrollmentRelationshipsRepository.capabilities();
  try {
    const context = await operatingContext();
    const { error } = await safetySupabase.from('relationship_suppressions').select('id').eq('tenant_id', context.tenantId).limit(1);
    const status = error ? capabilityState('suppression', capabilityStatusFromError(error), error.message) : capabilityState('suppression', 'available');
    replaceCapability(capabilities, status);
    replaceCapability(capabilities, error ? capabilityState('unsubscribe', capabilityStatusFromError(error), error.message) : capabilityState('unsubscribe', 'available'));
    return capabilities;
  } catch (error) {
    replaceCapability(capabilities, capabilityState('suppression', capabilityStatusFromError(error), errorMessage(error)));
    replaceCapability(capabilities, capabilityState('unsubscribe', capabilityStatusFromError(error), errorMessage(error)));
    return capabilities;
  }
}

async function listSuppressions(filters: Parameters<RelationshipsRepository['listSuppressions']>[0] = {}) {
  const context = await operatingContext();
  const paging = pageValues(filters.page, filters.pageSize);
  let query = safetySupabase.from('relationship_suppressions').select('*', { count: 'exact' }).eq('tenant_id', context.tenantId);
  if (filters.scopes?.length) query = query.in('scope', filters.scopes);
  if (filters.reasons?.length) query = query.in('reason', filters.reasons);
  if (filters.organizationId) query = query.eq('organization_id', filters.organizationId);
  if (filters.contactId) query = query.eq('contact_id', filters.contactId);
  if (filters.campaignId) query = query.eq('campaign_id', filters.campaignId);
  if (filters.email) query = query.eq('email', filters.email.trim().toLowerCase());
  if (filters.activeOnly !== false) {
    const now = new Date().toISOString();
    query = query.is('revoked_at', null).lte('effective_at', now).or(`expires_at.is.null,expires_at.gt.${now}`);
  }
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(paging.from, paging.to);
  if (error) throw new Error(error.message);
  return { items: (data ?? []).map(mapSuppressionRow), total: count ?? 0, page: paging.page, pageSize: paging.pageSize };
}

async function applySuppression(input: Parameters<RelationshipsRepository['applySuppression']>[0]) {
  const context = await operatingContext();
  requireMutation(context);
  const { idempotencyKey, ...payload } = input;
  const { data, error } = await safetySupabase.rpc('apply_relationship_suppression', {
    p_payload: payload as unknown as Json,
    p_idempotency_key: idempotencyKey?.trim() || newIdempotencyKey('relationship-suppression'),
  });
  if (error) throw new Error(error.message);
  return mapSuppressionResponse(data);
}

async function revokeSuppression(id: string, input: Parameters<RelationshipsRepository['revokeSuppression']>[1]) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await safetySupabase.rpc('revoke_relationship_suppression', {
    p_suppression_id: id,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey?.trim() || newIdempotencyKey('relationship-suppression-revoke'),
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return mapSuppressionResponse(data);
}

async function evaluateEnrollmentSafety(id: string) {
  await operatingContext();
  const { data, error } = await safetySupabase.rpc('evaluate_relationship_enrollment_safety', { p_enrollment_id: id });
  if (error) throw new Error(error.message);
  return mapRelationshipSafetyEvaluation(data);
}

async function revalidateEnrollmentSafety(id: string, input: Parameters<RelationshipsRepository['revalidateEnrollmentSafety']>[1]) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await safetySupabase.rpc('revalidate_relationship_enrollment_safety', {
    p_enrollment_id: id,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey?.trim() || newIdempotencyKey('relationship-safety-revalidate'),
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return mapRelationshipEnrollmentResponse(data);
}

async function processUnsubscribe(input: { token: string }) {
  const token = input.token.trim();
  if (!token) throw new Error('An unsubscribe token is required.');
  const { data, error } = await safetySupabase.rpc('process_relationship_unsubscribe', { p_token: token });
  if (error) throw new Error(error.message);
  return mapUnsubscribeResponse(data);
}

export const supabaseRelationshipsRepository: RelationshipsRepository = {
  ...enrollmentRelationshipsRepository,
  capabilities: safetyCapabilities,
  listSuppressions,
  applySuppression,
  revokeSuppression,
  evaluateEnrollmentSafety,
  revalidateEnrollmentSafety,
  processUnsubscribe,
};
