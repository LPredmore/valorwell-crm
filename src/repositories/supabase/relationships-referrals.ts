import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilityState } from '@/domain/relationships/capabilities';
import type {
  CapabilityAvailability,
  CapabilityStatus,
  ReferralDisclosure,
} from '@/domain/relationships/contracts';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { RelationshipsRepository } from '@/repositories/relationships';
import { supabaseRelationshipsRepository as baseRelationshipsRepository } from './relationships-lifecycle';
import {
  buildReferralInsert,
  buildReferralUpdate,
  mapReferralRow,
  type RelationshipReferralInsert,
  type RelationshipReferralRow,
  type RelationshipReferralUpdate,
} from './relationships-referral-mappers';

type OperatingContext = {
  tenantId: string;
  profileId: string;
  canMutate: boolean;
};

type ReferralDatabase = {
  public: {
    Tables: {
      relationship_referrals: {
        Row: RelationshipReferralRow;
        Insert: RelationshipReferralInsert;
        Update: RelationshipReferralUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      verify_relationship_referral: {
        Args: {
          p_referral_id: string;
          p_verified: boolean;
          p_disclosure: ReferralDisclosure;
          p_verified_at?: string | null;
          p_notes?: string | null;
        };
        Returns: RelationshipReferralRow;
      };
      revoke_relationship_referral: {
        Args: {
          p_referral_id: string;
          p_revoked_at?: string | null;
          p_note?: string | null;
        };
        Returns: RelationshipReferralRow;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const referralSupabase = supabase as unknown as SupabaseClient<ReferralDatabase>;

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
    throw new Error('You do not have permission to modify relationship referrals.');
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

function referralSubject(subject: { organizationId?: string; contactId?: string }) {
  const organizationId = subject.organizationId?.trim() || undefined;
  const contactId = subject.contactId?.trim() || undefined;
  if (!organizationId && !contactId) {
    throw new Error('An organization or contact is required for relationship referrals.');
  }
  return { organizationId, contactId };
}

async function referralCapabilities(): Promise<CapabilityAvailability[]> {
  const capabilities = await baseRelationshipsRepository.capabilities();
  try {
    const context = await operatingContext();
    const { error } = await referralSupabase
      .from('relationship_referrals')
      .select('id')
      .eq('tenant_id', context.tenantId)
      .limit(1);
    return replaceCapability(
      capabilities,
      error
        ? capabilityState('referrals', capabilityStatusFromError(error), error.message)
        : capabilityState('referrals', 'available'),
    );
  } catch (error) {
    return replaceCapability(
      capabilities,
      capabilityState('referrals', capabilityStatusFromError(error), errorMessage(error)),
    );
  }
}

async function listReferrals(subject: { organizationId?: string; contactId?: string }) {
  const context = await operatingContext();
  const normalized = referralSubject(subject);
  let query = referralSupabase
    .from('relationship_referrals')
    .select('*')
    .eq('tenant_id', context.tenantId)
    .order('created_at', { ascending: false });
  if (normalized.organizationId) query = query.eq('organization_id', normalized.organizationId);
  if (normalized.contactId) query = query.eq('contact_id', normalized.contactId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapReferralRow);
}

async function getReferral(id: string) {
  const context = await operatingContext();
  const { data, error } = await referralSupabase
    .from('relationship_referrals')
    .select('*')
    .eq('tenant_id', context.tenantId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapReferralRow(data) : null;
}

async function createReferral(input: Parameters<RelationshipsRepository['createReferral']>[0]) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await referralSupabase
    .from('relationship_referrals')
    .insert(buildReferralInsert(context.tenantId, context.profileId, input))
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapReferralRow(data);
}

async function updateReferral(
  id: string,
  input: Parameters<RelationshipsRepository['updateReferral']>[1],
) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await referralSupabase
    .from('relationship_referrals')
    .update(buildReferralUpdate(context.profileId, input))
    .eq('tenant_id', context.tenantId)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Relationship referral not found.');
  return mapReferralRow(data);
}

async function verifyReferral(
  id: string,
  input: Parameters<RelationshipsRepository['verifyReferral']>[1],
) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await referralSupabase.rpc('verify_relationship_referral', {
    p_referral_id: id,
    p_verified: input.verified,
    p_disclosure: input.disclosure,
    p_verified_at: input.verifiedAt,
    p_notes: input.notes?.trim() || null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Referral verification returned no record.');
  return mapReferralRow(data);
}

async function revokeReferral(
  id: string,
  input: Parameters<RelationshipsRepository['revokeReferral']>[1],
) {
  const context = await operatingContext();
  requireMutation(context);
  const { data, error } = await referralSupabase.rpc('revoke_relationship_referral', {
    p_referral_id: id,
    p_revoked_at: input.revokedAt,
    p_note: input.note?.trim() || null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Referral revocation returned no record.');
  return mapReferralRow(data);
}

export const supabaseRelationshipsRepository: RelationshipsRepository = {
  ...baseRelationshipsRepository,
  capabilities: referralCapabilities,
  listReferrals,
  getReferral,
  createReferral,
  updateReferral,
  verifyReferral,
  revokeReferral,
};