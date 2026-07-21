import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilityState } from '@/domain/relationships/capabilities';
import type {
  CapabilityAvailability,
  CapabilityStatus,
  OpportunityFilters,
  OpportunityStatus,
} from '@/domain/relationships/contracts';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { RelationshipsRepository } from '@/repositories/relationships';
import { supabaseRelationshipsRepository as baseRelationshipsRepository } from './relationships-referrals';
import {
  buildOpportunityInsert,
  buildOpportunityUpdate,
  mapOpportunityRow,
  type RelationshipOpportunityInsert,
  type RelationshipOpportunityRow,
  type RelationshipOpportunityUpdate,
} from './relationships-opportunity-mappers';

type OperatingContext = {
  tenantId: string;
  profileId: string;
  canMutate: boolean;
};

type OpportunityDatabase = {
  public: {
    Tables: {
      relationship_opportunities: {
        Row: RelationshipOpportunityRow;
        Insert: RelationshipOpportunityInsert;
        Update: RelationshipOpportunityUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      transition_relationship_opportunity_status: {
        Args: {
          p_opportunity_id: string;
          p_status: OpportunityStatus;
          p_reason?: string | null;
          p_expected_version?: number | null;
          p_changed_at?: string | null;
        };
        Returns: RelationshipOpportunityRow;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const opportunitySupabase = supabase as unknown as SupabaseClient<OpportunityDatabase>;
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
    throw new Error('You do not have permission to modify relationship opportunities.');
  }
}

function replaceCapability(
  capabilities: CapabilityAvailability[],
  replacement: CapabilityAvailability,
) {
  const index = capabilities.findIndex((item) => item.capability === replacement.capability);
  if (index >= 0) capabilities[index] = replacement;
  return capabilities;
}

function pageValues(filters: OpportunityFilters) {
  const page = Number.isInteger(filters.page) && (filters.page ?? 0) > 0 ? filters.page! : 1;
  const requested = Number.isInteger(filters.pageSize) && (filters.pageSize ?? 0) > 0
    ? filters.pageSize!
    : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(requested, MAX_PAGE_SIZE);
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

function safeSearch(value: string) {
  return value.trim().replace(/[,%()"']/g, ' ');
}

function sortColumn(sortBy: OpportunityFilters['sortBy']) {
  switch (sortBy) {
    case 'status': return 'status';
    case 'ownerId': return 'owner_profile_id';
    case 'causeArea': return 'cause_area';
    case 'veteranPriority': return 'veteran_priority';
    case 'nextAction': return 'next_action';
    case 'nextActionDueAt': return 'next_action_due_at';
    case 'createdAt': return 'created_at';
    case 'updatedAt': return 'updated_at';
    case 'organizationId': return 'organization_id';
    case 'primaryContactId': return 'primary_contact_id';
    default: return 'updated_at';
  }
}

async function opportunityCapabilities(): Promise<CapabilityAvailability[]> {
  const capabilities = await baseRelationshipsRepository.capabilities();
  try {
    const context = await operatingContext();
    const { error } = await opportunitySupabase
      .from('relationship_opportunities')
      .select('id')
      .eq('tenant_id', context.tenantId)
      .limit(1);
    return replaceCapability(
      capabilities,
      error
        ? capabilityState('opportunities', capabilityStatusFromError(error), error.message)
        : capabilityState('opportunities', 'available'),
    );
  } catch (error) {
    return replaceCapability(
      capabilities,
      capabilityState('opportunities', capabilityStatusFromError(error), errorMessage(error)),
    );
  }
}

async function listOpportunities(filters: OpportunityFilters) {
  const context = await operatingContext();
  const paging = pageValues(filters);
  let query = opportunitySupabase
    .from('relationship_opportunities')
    .select('*', { count: 'exact' })
    .eq('tenant_id', context.tenantId);

  if (filters.organizationIds?.length) query = query.in('organization_id', filters.organizationIds);
  if (filters.contactIds?.length) query = query.in('primary_contact_id', filters.contactIds);
  if (filters.statuses?.length) query = query.in('status', filters.statuses);
  if (filters.ownerIds?.length) query = query.in('owner_profile_id', filters.ownerIds);
  if (filters.veteranPriority !== undefined) query = query.eq('veteran_priority', filters.veteranPriority);
  if (filters.causeAreas?.length) query = query.in('cause_area', filters.causeAreas);
  if (filters.reviewStatuses?.length) query = query.in('review_status', filters.reviewStatuses);
  if (filters.riskFlags?.length) query = query.contains('risk_flags', filters.riskFlags);
  if (filters.overdueNextAction) query = query.lt('next_action_due_at', new Date().toISOString());
  if (filters.search?.trim()) {
    const search = safeSearch(filters.search);
    const organizations = await baseRelationshipsRepository.listOrganizations({
      search,
      page: 1,
      pageSize: 100,
    });
    const organizationIds = organizations.items.map((organization) => organization.id);
    query = organizationIds.length
      ? query.or(`cause_area.ilike.%${search}%,next_action.ilike.%${search}%,organization_id.in.(${organizationIds.join(',')})`)
      : query.or(`cause_area.ilike.%${search}%,next_action.ilike.%${search}%`);
  }

  const { data, error, count } = await query
    .order(sortColumn(filters.sortBy), { ascending: filters.sortDirection === 'asc' })
    .range(paging.from, paging.to);
  if (error) throw new Error(error.message);
  return {
    items: (data ?? []).map(mapOpportunityRow),
    total: count ?? 0,
    page: paging.page,
    pageSize: paging.pageSize,
  };
}

async function getOpportunity(id: string) {
  const context = await operatingContext();
  const { data, error } = await opportunitySupabase
    .from('relationship_opportunities')
    .select('*')
    .eq('tenant_id', context.tenantId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapOpportunityRow(data) : null;
}

async function createOpportunity(input: Parameters<RelationshipsRepository['createOpportunity']>[0]) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await opportunitySupabase
    .from('relationship_opportunities')
    .insert(buildOpportunityInsert(context.tenantId, context.profileId, input))
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapOpportunityRow(data);
}

async function updateOpportunity(
  id: string,
  input: Parameters<RelationshipsRepository['updateOpportunity']>[1],
) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await opportunitySupabase
    .from('relationship_opportunities')
    .update(buildOpportunityUpdate(context.profileId, input))
    .eq('tenant_id', context.tenantId)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Relationship opportunity not found.');
  return mapOpportunityRow(data);
}

async function transitionOpportunityStatus(
  id: string,
  input: Parameters<RelationshipsRepository['transitionOpportunityStatus']>[1],
) {
  const context = await operatingContext();
  requireMutation(context);
  const current = await opportunitySupabase
    .from('relationship_opportunities')
    .select('*')
    .eq('tenant_id', context.tenantId)
    .eq('id', id)
    .maybeSingle();
  if (current.error) throw new Error(current.error.message);
  if (!current.data) throw new Error('Relationship opportunity not found.');

  const { data, error } = await opportunitySupabase.rpc('transition_relationship_opportunity_status', {
    p_opportunity_id: id,
    p_status: input.status,
    p_reason: input.reason?.trim() || null,
    p_expected_version: current.data.version,
    p_changed_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Opportunity status transition returned no record.');
  return mapOpportunityRow(row);
}

export const supabaseRelationshipsRepository: RelationshipsRepository = {
  ...baseRelationshipsRepository,
  capabilities: opportunityCapabilities,
  listOpportunities,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  transitionOpportunityStatus,
};
