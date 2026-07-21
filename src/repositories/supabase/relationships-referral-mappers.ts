import type {
  CreateReferralInput,
  Referral,
  ReferralDisclosure,
  UpdateReferralInput,
} from '@/domain/relationships/contracts';
import { validateReferralInput } from '@/domain/relationships/referral-workflow';
import type { Json } from '@/integrations/supabase/types';

export type RelationshipReferralRow = {
  id: string;
  tenant_id: string;
  organization_id: string | null;
  contact_id: string | null;
  source_category: string;
  summary: string;
  evidence_urls: string[];
  verified: boolean;
  verified_at: string | null;
  verified_by_profile_id: string | null;
  revoked_at: string | null;
  disclosure: ReferralDisclosure;
  named_referrer: string | null;
  notes: string | null;
  metadata: Json;
  created_by_profile_id: string | null;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

export type RelationshipReferralInsert = {
  tenant_id: string;
  organization_id: string | null;
  contact_id: string | null;
  source_category: string;
  summary: string;
  evidence_urls: string[];
  verified: false;
  disclosure: ReferralDisclosure;
  named_referrer: string | null;
  notes: string | null;
  created_by_profile_id: string;
  updated_by_profile_id: string;
};

export type RelationshipReferralUpdate = Partial<Pick<
  RelationshipReferralRow,
  'source_category' | 'summary' | 'evidence_urls' | 'disclosure' | 'named_referrer' | 'notes' | 'updated_by_profile_id'
>>;

function optionalText(value?: string) {
  const normalized = value?.trim();
  return normalized || null;
}

export function normalizeEvidenceUrls(values: string[] = []) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].map((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`Invalid evidence URL: ${value}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Evidence URLs must use HTTP or HTTPS: ${value}`);
    }
    return parsed.toString();
  });
}

export function buildReferralInsert(
  tenantId: string,
  profileId: string,
  input: CreateReferralInput,
): RelationshipReferralInsert {
  const validation = validateReferralInput(input);
  if (!validation.valid) {
    throw new Error(validation.formError ?? Object.values(validation.fieldErrors)[0] ?? 'Invalid referral.');
  }
  if (input.verified) {
    throw new Error('Create the referral first, then verify it through the verification workflow.');
  }

  return {
    tenant_id: tenantId,
    organization_id: input.organizationId?.trim() || null,
    contact_id: input.contactId?.trim() || null,
    source_category: input.sourceCategory.trim(),
    summary: input.summary.trim(),
    evidence_urls: normalizeEvidenceUrls(input.evidenceUrls),
    verified: false,
    disclosure: input.disclosure,
    named_referrer: input.disclosure === 'named_referrer' ? optionalText(input.namedReferrer) : null,
    notes: optionalText(input.notes),
    created_by_profile_id: profileId,
    updated_by_profile_id: profileId,
  };
}

export function buildReferralUpdate(
  profileId: string,
  input: UpdateReferralInput,
): RelationshipReferralUpdate {
  if ('verified' in input && input.verified !== undefined) {
    throw new Error('Use the referral verification workflow to change verification status.');
  }

  const patch: RelationshipReferralUpdate = { updated_by_profile_id: profileId };
  if (input.sourceCategory !== undefined) {
    const sourceCategory = input.sourceCategory.trim();
    if (!sourceCategory) throw new Error('Source category is required.');
    patch.source_category = sourceCategory;
  }
  if (input.summary !== undefined) {
    const summary = input.summary.trim();
    if (!summary) throw new Error('Source summary is required.');
    patch.summary = summary;
  }
  if (input.evidenceUrls !== undefined) patch.evidence_urls = normalizeEvidenceUrls(input.evidenceUrls);
  if (input.disclosure !== undefined) patch.disclosure = input.disclosure;

  const disclosure = input.disclosure;
  if (input.namedReferrer !== undefined || disclosure !== undefined) {
    if (disclosure === 'named_referrer') {
      const namedReferrer = optionalText(input.namedReferrer);
      if (!namedReferrer) throw new Error('A named referrer is required for named disclosure.');
      patch.named_referrer = namedReferrer;
    } else if (disclosure !== undefined) {
      patch.named_referrer = null;
    } else {
      patch.named_referrer = optionalText(input.namedReferrer);
    }
  }
  if (input.notes !== undefined) patch.notes = optionalText(input.notes);
  return patch;
}

export function mapReferralRow(row: RelationshipReferralRow): Referral {
  return {
    id: row.id,
    organizationId: row.organization_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    sourceCategory: row.source_category,
    summary: row.summary,
    evidenceUrls: row.evidence_urls,
    verified: row.verified,
    verifiedAt: row.verified_at ?? undefined,
    verifiedBy: row.verified_by_profile_id ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    disclosure: row.disclosure,
    namedReferrer: row.named_referrer ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by_profile_id ?? undefined,
    updatedBy: row.updated_by_profile_id ?? undefined,
  };
}