import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilityState } from '@/domain/relationships/capabilities';
import type {
  CapabilityAvailability,
  CapabilityStatus,
  InteractionFilters,
  RelationshipStage,
} from '@/domain/relationships/contracts';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { RelationshipsRepository, RelationshipSubject } from '@/repositories/relationships';
import { supabaseRelationshipsRepository as baseRelationshipsRepository } from './relationships';
import {
  assertInteractionSubject,
  assertStageSubject,
  buildInteractionInsert,
  mapInteractionRow,
  mapStageHistoryRow,
  type LifecycleInteractionInsert,
  type LifecycleInteractionRow,
  type LifecycleStageHistoryRow,
} from './relationships-lifecycle-mappers';

type OperatingContext = {
  tenantId: string;
  profileId: string;
  canMutate: boolean;
};

type LifecycleDatabase = {
  public: {
    Tables: {
      relationship_stage_history: {
        Row: LifecycleStageHistoryRow;
        Insert: Partial<LifecycleStageHistoryRow>;
        Update: never;
        Relationships: [];
      };
      relationship_interactions: {
        Row: LifecycleInteractionRow;
        Insert: LifecycleInteractionInsert;
        Update: Partial<LifecycleInteractionInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      transition_relationship_stage: {
        Args: {
          p_to_stage: RelationshipStage;
          p_organization_id?: string | null;
          p_contact_id?: string | null;
          p_reason?: string | null;
          p_changed_at?: string | null;
        };
        Returns: LifecycleStageHistoryRow;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const lifecycleSupabase = supabase as unknown as SupabaseClient<LifecycleDatabase>;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function isJsonObject(value: Json | undefined): value is { [key: string]: Json | undefined } {
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
  if (message.includes('fetch') || message.includes('network') || message.includes('offline')) {
    return 'network_error';
  }
  if (message.includes('invalid') || message.includes('malformed')) return 'invalid_response';
  return 'query_error';
}

async function operatingContext(): Promise<OperatingContext> {
  const { data, error } = await supabase.rpc('get_crm_operating_context');
  if (error) throw new Error(error.message);
  if (!isJsonObject(data)) throw new Error('Invalid CRM operating context response.');
  if (data.authenticated !== true) throw new Error('Authenticated CRM access is required.');

  const tenantId = data.current_tenant_id;
  const profileId = data.profile_id;
  const capabilities = data.capabilities;
  if (typeof tenantId !== 'string' || !tenantId) {
    throw new Error('No operating tenant is selected for this CRM session.');
  }
  if (typeof profileId !== 'string' || !profileId) {
    throw new Error('Invalid CRM profile context.');
  }

  return {
    tenantId,
    profileId,
    canMutate: isJsonObject(capabilities) && capabilities.mutate === true,
  };
}

function requireMutation(context: OperatingContext) {
  if (!context.canMutate) {
    throw new Error('You do not have permission to modify relationship records.');
  }
}

function pageValues(filters?: InteractionFilters) {
  const page = Number.isInteger(filters?.page) && (filters?.page ?? 0) > 0 ? filters!.page! : 1;
  const requested = Number.isInteger(filters?.pageSize) && (filters?.pageSize ?? 0) > 0
    ? filters!.pageSize!
    : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(requested, MAX_PAGE_SIZE);
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

function replaceCapability(
  capabilities: CapabilityAvailability[],
  replacement: CapabilityAvailability,
) {
  const index = capabilities.findIndex((item) => item.capability === replacement.capability);
  if (index >= 0) capabilities[index] = replacement;
  return capabilities;
}

async function lifecycleCapabilities(): Promise<CapabilityAvailability[]> {
  const capabilities = await baseRelationshipsRepository.capabilities();
  try {
    const context = await operatingContext();
    const [history, interactions] = await Promise.all([
      lifecycleSupabase
        .from('relationship_stage_history')
        .select('id')
        .eq('tenant_id', context.tenantId)
        .limit(1),
      lifecycleSupabase
        .from('relationship_interactions')
        .select('id')
        .eq('tenant_id', context.tenantId)
        .limit(1),
    ]);
    const error = history.error ?? interactions.error;
    return replaceCapability(
      capabilities,
      error
        ? capabilityState('interactions', capabilityStatusFromError(error), error.message)
        : capabilityState('interactions', 'available'),
    );
  } catch (error) {
    return replaceCapability(
      capabilities,
      capabilityState('interactions', capabilityStatusFromError(error), errorMessage(error)),
    );
  }
}

async function listStageHistory(subject: RelationshipSubject) {
  const context = await operatingContext();
  const normalized = assertStageSubject(subject);
  let query = lifecycleSupabase
    .from('relationship_stage_history')
    .select('*')
    .eq('tenant_id', context.tenantId)
    .order('changed_at', { ascending: false });

  query = normalized.organizationId
    ? query.eq('organization_id', normalized.organizationId)
    : query.eq('contact_id', normalized.contactId!);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapStageHistoryRow);
}

async function transitionStage(input: {
  subject: RelationshipSubject;
  to: RelationshipStage;
  reason?: string;
}) {
  const context = await operatingContext();
  requireMutation(context);
  const subject = assertStageSubject(input.subject);
  const { data, error } = await lifecycleSupabase.rpc('transition_relationship_stage', {
    p_to_stage: input.to,
    p_organization_id: subject.organizationId,
    p_contact_id: subject.contactId,
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Relationship stage transition returned no history record.');
  return mapStageHistoryRow(data);
}

async function listInteractions(subject: RelationshipSubject, filters?: InteractionFilters) {
  const context = await operatingContext();
  const normalized = assertInteractionSubject(subject);
  const paging = pageValues(filters);
  let query = lifecycleSupabase
    .from('relationship_interactions')
    .select('*', { count: 'exact' })
    .eq('tenant_id', context.tenantId);

  if (normalized.organizationId) query = query.eq('organization_id', normalized.organizationId);
  if (normalized.contactId) query = query.eq('contact_id', normalized.contactId);
  if (normalized.opportunityId) query = query.eq('opportunity_id', normalized.opportunityId);
  if (filters?.types?.length) query = query.in('interaction_type', filters.types);
  if (filters?.occurred?.from) query = query.gte('occurred_at', filters.occurred.from);
  if (filters?.occurred?.to) query = query.lte('occurred_at', filters.occurred.to);

  const { data, error, count } = await query
    .order('occurred_at', { ascending: false })
    .range(paging.from, paging.to);
  if (error) throw new Error(error.message);
  return {
    items: (data ?? []).map(mapInteractionRow),
    total: count ?? 0,
    page: paging.page,
    pageSize: paging.pageSize,
  };
}

async function createInteraction(input: Parameters<RelationshipsRepository['createInteraction']>[0]) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await lifecycleSupabase
    .from('relationship_interactions')
    .insert(buildInteractionInsert(context.tenantId, context.profileId, input))
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapInteractionRow(data);
}

export const supabaseRelationshipsRepository: RelationshipsRepository = {
  ...baseRelationshipsRepository,
  capabilities: lifecycleCapabilities,
  listStageHistory,
  transitionStage,
  listInteractions,
  createInteraction,
};
