import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilityState } from '@/domain/relationships/capabilities';
import type {
  CapabilityAvailability,
  CapabilityStatus,
} from '@/domain/relationships/contracts';
import type {
  RelationshipCampaignDefinitionInput,
  RelationshipCampaignFilters,
  RelationshipCampaignStatus,
} from '@/domain/relationships/campaign-contracts';
import { campaignDefinitionErrors } from '@/domain/relationships/campaign-workflow';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { RelationshipsRepository } from '@/repositories/relationships';
import { supabaseRelationshipsRepository as baseRelationshipsRepository } from './relationships-imports';
import {
  mapRelationshipCampaignResponse,
  mapRelationshipCampaignRow,
  relationshipCampaignPayload,
  relationshipCampaignStepsPayload,
  type RelationshipCampaignRow,
} from './relationships-campaign-mappers';

type OperatingContext = {
  tenantId: string;
  canMutate: boolean;
};

type RelationshipCampaignDatabase = {
  public: {
    Tables: {
      relationship_campaigns: {
        Row: RelationshipCampaignRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_relationship_campaign: {
        Args: { p_campaign_id: string };
        Returns: Json;
      };
      save_relationship_campaign: {
        Args: {
          p_campaign_id?: string | null;
          p_expected_version?: number | null;
          p_idempotency_key: string;
          p_campaign: Json;
          p_steps: Json;
        };
        Returns: Json;
      };
      transition_relationship_campaign: {
        Args: {
          p_campaign_id: string;
          p_to_status: RelationshipCampaignStatus;
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

const campaignSupabase = supabase as unknown as SupabaseClient<RelationshipCampaignDatabase>;
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
  if (!context.canMutate) {
    throw new Error('You do not have permission to manage relationship campaigns.');
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

function pageValues(filters: RelationshipCampaignFilters) {
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

function sortColumn(sortBy: RelationshipCampaignFilters['sortBy']) {
  switch (sortBy) {
    case 'name': return 'name';
    case 'status': return 'status';
    case 'createdAt': return 'created_at';
    default: return 'updated_at';
  }
}

function newIdempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

async function campaignCapabilities(): Promise<CapabilityAvailability[]> {
  const capabilities = await baseRelationshipsRepository.capabilities();
  try {
    const context = await operatingContext();
    const { error } = await campaignSupabase
      .from('relationship_campaigns')
      .select('id')
      .eq('tenant_id', context.tenantId)
      .limit(1);
    return replaceCapability(
      capabilities,
      error
        ? capabilityState('campaigns', capabilityStatusFromError(error), error.message)
        : capabilityState('campaigns', 'available'),
    );
  } catch (error) {
    return replaceCapability(
      capabilities,
      capabilityState('campaigns', capabilityStatusFromError(error), errorMessage(error)),
    );
  }
}

async function listCampaigns(filters: RelationshipCampaignFilters) {
  const context = await operatingContext();
  const paging = pageValues(filters);
  let query = campaignSupabase
    .from('relationship_campaigns')
    .select('*', { count: 'exact' })
    .eq('tenant_id', context.tenantId);

  if (filters.statuses?.length) query = query.in('status', filters.statuses);
  if (filters.ownerIds?.length) query = query.in('owner_profile_id', filters.ownerIds);
  if (filters.initiatives?.length) query = query.in('initiative', filters.initiatives);
  if (filters.search?.trim()) {
    const search = safeSearch(filters.search);
    query = query.or(`name.ilike.%${search}%,purpose.ilike.%${search}%,initiative.ilike.%${search}%`);
  }

  const { data, error, count } = await query
    .order(sortColumn(filters.sortBy), { ascending: filters.sortDirection === 'asc' })
    .range(paging.from, paging.to);
  if (error) throw new Error(error.message);
  return {
    items: (data ?? []).map(mapRelationshipCampaignRow),
    total: count ?? 0,
    page: paging.page,
    pageSize: paging.pageSize,
  };
}

async function getCampaign(id: string) {
  await operatingContext();
  const { data, error } = await campaignSupabase.rpc('get_relationship_campaign', {
    p_campaign_id: id,
  });
  if (error) {
    if (error.code === 'P0002') return null;
    throw new Error(error.message);
  }
  return mapRelationshipCampaignResponse(data);
}

async function saveCampaign(
  campaignId: string | undefined,
  input: RelationshipCampaignDefinitionInput,
  expectedVersion?: number,
  idempotencyKey?: string,
) {
  const context = await operatingContext();
  requireMutation(context);
  const errors = campaignDefinitionErrors(input);
  if (errors.length) throw new Error(errors.join(' '));
  const { data, error } = await campaignSupabase.rpc('save_relationship_campaign', {
    p_campaign_id: campaignId ?? null,
    p_expected_version: expectedVersion ?? null,
    p_idempotency_key: idempotencyKey?.trim() || newIdempotencyKey('relationship-campaign-save'),
    p_campaign: relationshipCampaignPayload(input),
    p_steps: relationshipCampaignStepsPayload(input),
  });
  if (error) throw new Error(error.message);
  return mapRelationshipCampaignResponse(data);
}

async function createCampaign(
  input: Parameters<RelationshipsRepository['createCampaign']>[0],
) {
  return saveCampaign(undefined, input.definition, undefined, input.idempotencyKey);
}

async function updateCampaign(
  id: string,
  input: Parameters<RelationshipsRepository['updateCampaign']>[1],
) {
  return saveCampaign(id, input.definition, input.expectedVersion, input.idempotencyKey);
}

async function transitionCampaignStatus(
  id: string,
  input: Parameters<RelationshipsRepository['transitionCampaignStatus']>[1],
) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await campaignSupabase.rpc('transition_relationship_campaign', {
    p_campaign_id: id,
    p_to_status: input.status,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey?.trim() || newIdempotencyKey('relationship-campaign-transition'),
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return mapRelationshipCampaignResponse(data);
}

export const supabaseRelationshipsRepository: RelationshipsRepository = {
  ...baseRelationshipsRepository,
  capabilities: campaignCapabilities,
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  transitionCampaignStatus,
};
