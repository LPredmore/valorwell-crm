import type {
  CreateOpportunityInput,
  OpportunityStatus,
  RelationshipOpportunity,
  UpdateOpportunityInput,
} from '@/domain/relationships/contracts';
import type { Json } from '@/integrations/supabase/types';

export type RelationshipOpportunityRow = {
  id: string;
  tenant_id: string;
  organization_id: string;
  primary_contact_id: string | null;
  status: OpportunityStatus;
  owner_profile_id: string | null;
  cause_area: string | null;
  veteran_priority: boolean;
  qualification: Json;
  review_status: string;
  risk_flags: string[];
  next_action: string | null;
  next_action_due_at: string | null;
  status_changed_at: string;
  closed_at: string | null;
  version: number;
  metadata: Json;
  created_by_profile_id: string | null;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

export type RelationshipOpportunityInsert = {
  tenant_id: string;
  organization_id: string;
  primary_contact_id?: string | null;
  status: OpportunityStatus;
  owner_profile_id?: string | null;
  cause_area?: string | null;
  veteran_priority: boolean;
  qualification: Json;
  next_action?: string | null;
  next_action_due_at?: string | null;
  created_by_profile_id: string;
  updated_by_profile_id: string;
};

export type RelationshipOpportunityUpdate = {
  primary_contact_id?: string | null;
  owner_profile_id?: string | null;
  cause_area?: string | null;
  veteran_priority?: boolean;
  qualification?: Json;
  next_action?: string | null;
  next_action_due_at?: string | null;
  updated_by_profile_id: string;
};

function qualificationFromJson(value: Json): RelationshipOpportunity['qualification'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => (
      item === undefined
      || typeof item === 'string'
      || typeof item === 'boolean'
      || typeof item === 'number'
    )),
  ) as RelationshipOpportunity['qualification'];
}

function qualificationToJson(value: RelationshipOpportunity['qualification']): Json {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => (
      item === undefined
      || typeof item === 'string'
      || typeof item === 'boolean'
      || typeof item === 'number'
    )),
  ) as Json;
}

export function mapOpportunityRow(row: RelationshipOpportunityRow): RelationshipOpportunity {
  return {
    id: row.id,
    organizationId: row.organization_id,
    primaryContactId: row.primary_contact_id ?? undefined,
    status: row.status,
    ownerId: row.owner_profile_id ?? undefined,
    causeArea: row.cause_area ?? undefined,
    veteranPriority: row.veteran_priority,
    qualification: qualificationFromJson(row.qualification),
    nextAction: row.next_action ?? undefined,
    nextActionDueAt: row.next_action_due_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by_profile_id ?? undefined,
    updatedBy: row.updated_by_profile_id ?? undefined,
  };
}

export function buildOpportunityInsert(
  tenantId: string,
  profileId: string,
  input: CreateOpportunityInput,
): RelationshipOpportunityInsert {
  return {
    tenant_id: tenantId,
    organization_id: input.organizationId,
    primary_contact_id: input.primaryContactId?.trim() || null,
    status: input.status,
    owner_profile_id: input.ownerId?.trim() || null,
    cause_area: input.causeArea?.trim() || null,
    veteran_priority: input.veteranPriority ?? false,
    qualification: qualificationToJson(input.qualification),
    next_action: input.nextAction?.trim() || null,
    next_action_due_at: input.nextActionDueAt || null,
    created_by_profile_id: profileId,
    updated_by_profile_id: profileId,
  };
}

export function buildOpportunityUpdate(
  profileId: string,
  input: UpdateOpportunityInput,
): RelationshipOpportunityUpdate {
  if (input.status !== undefined) {
    throw new Error('Use the opportunity status transition workflow to change status.');
  }
  const update: RelationshipOpportunityUpdate = { updated_by_profile_id: profileId };
  if ('primaryContactId' in input) update.primary_contact_id = input.primaryContactId?.trim() || null;
  if ('ownerId' in input) update.owner_profile_id = input.ownerId?.trim() || null;
  if ('causeArea' in input) update.cause_area = input.causeArea?.trim() || null;
  if ('veteranPriority' in input) update.veteran_priority = input.veteranPriority ?? false;
  if ('qualification' in input && input.qualification) update.qualification = qualificationToJson(input.qualification);
  if ('nextAction' in input) update.next_action = input.nextAction?.trim() || null;
  if ('nextActionDueAt' in input) update.next_action_due_at = input.nextActionDueAt || null;
  return update;
}
