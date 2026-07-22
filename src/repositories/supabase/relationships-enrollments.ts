import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilityState } from '@/domain/relationships/capabilities';
import type { CapabilityAvailability, CapabilityStatus } from '@/domain/relationships/contracts';
import type {
  RelationshipEnrollmentEventRow,
  RelationshipEnrollmentRow,
} from './relationships-enrollment-mappers';
import {
  mapRelationshipEnrollmentEligibility,
  mapRelationshipEnrollmentEventRow,
  mapRelationshipEnrollmentResponse,
  mapRelationshipEnrollmentRow,
} from './relationships-enrollment-mappers';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { RelationshipsRepository } from '@/repositories/relationships';
import { supabaseRelationshipsRepository as campaignRelationshipsRepository } from './relationships-campaigns';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type OperatingContext = { tenantId: string; canMutate: boolean };

type RelationshipEnrollmentDatabase = {
  public: {
    Tables: {
      relationship_campaign_enrollments: {
        Row: RelationshipEnrollmentRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      relationship_enrollment_events: {
        Row: RelationshipEnrollmentEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      evaluate_relationship_campaign_eligibility: {
        Args: { p_campaign_id: string; p_targets: Json };
        Returns: Json;
      };
      enroll_relationship_targets: {
        Args: {
          p_campaign_id: string;
          p_targets: Json;
          p_expected_campaign_version: number;
          p_idempotency_key: string;
        };
        Returns: Json;
      };
      transition_relationship_campaign_enrollment: {
        Args: {
          p_enrollment_id: string;
          p_to_status: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_reason?: string | null;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const enrollmentSupabase = supabase as unknown as SupabaseClient<RelationshipEnrollmentDatabase>;

type JsonObject = { [key: string]: Json | undefined };

function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function capabilityStatusFromError(error: unknown): CapabilityStatus {
  const message = errorMessage(error).toLowerCase();
  if (
    message.includes('permission')
    || message.includes('not authorized')
    || message.includes('row-level security')
    || message.includes('operating tenant')
    || message.includes('authenticated')
    || message.includes('42501')
  ) return 'permission_denied';
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
  if (typeof tenantId !== 'string' || !tenantId) {
    throw new Error('No operating tenant is selected for this CRM session.');
  }
  return {
    tenantId,
    canMutate: isJsonObject(capabilities) && capabilities.mutate === true,
  };
}

function requireMutation(context: OperatingContext) {
  if (!context.canMutate) throw new Error('You do not have permission to manage campaign enrollments.');
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

async function enrollmentCapabilities(): Promise<CapabilityAvailability[]> {
  const capabilities = await campaignRelationshipsRepository.capabilities();
  try {
    const context = await operatingContext();
    const { error } = await enrollmentSupabase
      .from('relationship_campaign_enrollments')
      .select('id')
      .eq('tenant_id', context.tenantId)
      .limit(1);
    return replaceCapability(
      capabilities,
      error
        ? capabilityState('enrollment', capabilityStatusFromError(error), error.message)
        : capabilityState('enrollment', 'available'),
    );
  } catch (error) {
    return replaceCapability(
      capabilities,
      capabilityState('enrollment', capabilityStatusFromError(error), errorMessage(error)),
    );
  }
}

async function evaluateEnrollmentEligibility(
  campaignId: string,
  targets: Parameters<RelationshipsRepository['evaluateEnrollmentEligibility']>[1],
) {
  await operatingContext();
  const { data, error } = await enrollmentSupabase.rpc('evaluate_relationship_campaign_eligibility', {
    p_campaign_id: campaignId,
    p_targets: targets as unknown as Json,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('Invalid enrollment eligibility response.');
  return data.map((item) => mapRelationshipEnrollmentEligibility(item));
}

async function listEnrollments(
  campaignId: string,
  filters: Parameters<RelationshipsRepository['listEnrollments']>[1] = {},
) {
  const context = await operatingContext();
  const paging = pageValues(filters.page, filters.pageSize);
  let query = enrollmentSupabase
    .from('relationship_campaign_enrollments')
    .select('*', { count: 'exact' })
    .eq('tenant_id', context.tenantId)
    .eq('campaign_id', campaignId);
  if (filters.statuses?.length) query = query.in('status', filters.statuses);
  if (filters.contactIds?.length) query = query.in('contact_id', filters.contactIds);
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(paging.from, paging.to);
  if (error) throw new Error(error.message);
  return {
    items: (data ?? []).map(mapRelationshipEnrollmentRow),
    total: count ?? 0,
    page: paging.page,
    pageSize: paging.pageSize,
  };
}

async function getEnrollment(id: string) {
  const context = await operatingContext();
  const { data, error } = await enrollmentSupabase
    .from('relationship_campaign_enrollments')
    .select('*')
    .eq('tenant_id', context.tenantId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRelationshipEnrollmentRow(data) : null;
}

async function enroll(
  campaignId: string,
  input: Parameters<RelationshipsRepository['enroll']>[1],
) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await enrollmentSupabase.rpc('enroll_relationship_targets', {
    p_campaign_id: campaignId,
    p_targets: input.targets as unknown as Json,
    p_expected_campaign_version: input.expectedCampaignVersion,
    p_idempotency_key: input.idempotencyKey?.trim() || newIdempotencyKey('relationship-enroll'),
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('Invalid enrollment response.');
  return data.map((item) => mapRelationshipEnrollmentResponse(item));
}

async function transitionEnrollmentStatus(
  id: string,
  input: Parameters<RelationshipsRepository['transitionEnrollmentStatus']>[1],
) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await enrollmentSupabase.rpc('transition_relationship_campaign_enrollment', {
    p_enrollment_id: id,
    p_to_status: input.status,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey?.trim() || newIdempotencyKey('relationship-enrollment-transition'),
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return mapRelationshipEnrollmentResponse(data);
}

async function listEnrollmentEvents(id: string) {
  const context = await operatingContext();
  const { data, error } = await enrollmentSupabase
    .from('relationship_enrollment_events')
    .select('*')
    .eq('tenant_id', context.tenantId)
    .eq('enrollment_id', id)
    .order('occurred_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRelationshipEnrollmentEventRow);
}

export const supabaseRelationshipsRepository: RelationshipsRepository = {
  ...campaignRelationshipsRepository,
  capabilities: enrollmentCapabilities,
  evaluateEnrollmentEligibility,
  listEnrollments,
  getEnrollment,
  enroll,
  transitionEnrollmentStatus,
  listEnrollmentEvents,
};
