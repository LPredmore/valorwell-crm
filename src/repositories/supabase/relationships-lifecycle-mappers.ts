import type {
  CreateInteractionInput,
  InteractionType,
  RelationshipInteraction,
  RelationshipStage,
  RelationshipStageHistory,
} from '@/domain/relationships/contracts';
import type { Json } from '@/integrations/supabase/types';
import type { RelationshipSubject } from '@/repositories/relationships';

export type LifecycleStageHistoryRow = {
  id: string;
  tenant_id: string;
  organization_id: string | null;
  contact_id: string | null;
  from_stage: RelationshipStage | null;
  to_stage: RelationshipStage;
  changed_at: string;
  reason: string | null;
  metadata: Json;
  created_by_profile_id: string | null;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

export type LifecycleInteractionRow = {
  id: string;
  tenant_id: string;
  organization_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  interaction_type: InteractionType;
  occurred_at: string;
  summary: string;
  metadata: Json;
  created_by_profile_id: string | null;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

export type LifecycleInteractionInsert = {
  tenant_id: string;
  organization_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  interaction_type: InteractionType;
  occurred_at: string;
  summary: string;
  created_by_profile_id: string;
  updated_by_profile_id: string;
};

export type StageSubject = {
  organizationId: string | null;
  contactId: string | null;
};

function nonEmpty(value?: string) {
  const normalized = value?.trim();
  return normalized || null;
}

export function assertStageSubject(subject: RelationshipSubject): StageSubject {
  const organizationId = nonEmpty(subject.organizationId);
  const contactId = nonEmpty(subject.contactId);
  const opportunityId = nonEmpty(subject.opportunityId);

  if (opportunityId || Number(Boolean(organizationId)) + Number(Boolean(contactId)) !== 1) {
    throw new Error('Exactly one relationship organization or contact is required.');
  }

  return { organizationId, contactId };
}

export function assertInteractionSubject(subject: RelationshipSubject): RelationshipSubject {
  const normalized = {
    organizationId: nonEmpty(subject.organizationId) ?? undefined,
    contactId: nonEmpty(subject.contactId) ?? undefined,
    opportunityId: nonEmpty(subject.opportunityId) ?? undefined,
  };

  if (!normalized.organizationId && !normalized.contactId && !normalized.opportunityId) {
    throw new Error('A relationship organization, contact, or opportunity is required.');
  }

  return normalized;
}

export function buildInteractionInsert(
  tenantId: string,
  profileId: string,
  input: CreateInteractionInput,
): LifecycleInteractionInsert {
  const subject = assertInteractionSubject(input);
  if (!subject.organizationId && !subject.contactId) {
    throw new Error('An organization or contact is required to create a relationship interaction.');
  }

  const summary = input.summary.trim();
  if (!summary) throw new Error('Interaction summary is required.');

  return {
    tenant_id: tenantId,
    organization_id: subject.organizationId ?? null,
    contact_id: subject.contactId ?? null,
    opportunity_id: subject.opportunityId ?? null,
    interaction_type: input.type,
    occurred_at: input.occurredAt,
    summary,
    created_by_profile_id: profileId,
    updated_by_profile_id: profileId,
  };
}

export function mapStageHistoryRow(row: LifecycleStageHistoryRow): RelationshipStageHistory {
  return {
    id: row.id,
    organizationId: row.organization_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    from: row.from_stage ?? undefined,
    to: row.to_stage,
    changedAt: row.changed_at,
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by_profile_id ?? undefined,
    updatedBy: row.updated_by_profile_id ?? undefined,
  };
}

export function mapInteractionRow(row: LifecycleInteractionRow): RelationshipInteraction {
  return {
    id: row.id,
    organizationId: row.organization_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    opportunityId: row.opportunity_id ?? undefined,
    type: row.interaction_type,
    actorId: row.created_by_profile_id ?? undefined,
    occurredAt: row.occurred_at,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by_profile_id ?? undefined,
    updatedBy: row.updated_by_profile_id ?? undefined,
  };
}
