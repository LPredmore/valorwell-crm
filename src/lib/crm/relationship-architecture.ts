export const RELATIONSHIP_DOMAIN_KEY = 'business_development_relationships' as const;

export type RelationshipReleaseStatus = 'not_evaluated' | 'release_candidate' | 'accepted' | 'rejected';
export type RelationshipActivationStatus = 'locked' | 'pilot_ready' | 'active' | 'suspended';

export type RelationshipArchitectureContract = {
  domain_key: string;
  canonical_database: string;
  canonical_application: string;
  inbound_lane: string;
  outbound_lane: string;
  clinical_campaign_lane: string;
  clinical_campaign_boundary_enforced: boolean;
  implementation_status: string;
  terminology: Record<string, string>;
  contract_version: number;
  schema_fingerprint: string | null;
  generated_type_hash: string | null;
  capability_manifest: Record<string, string>;
  object_inventory: unknown;
  rpc_signatures: unknown[];
  grant_manifest: unknown;
  release_status: RelationshipReleaseStatus;
  activation_status: RelationshipActivationStatus;
  activation_blockers: string[];
  acceptance_evidence: Record<string, unknown>;
  accepted_at: string | null;
  effective_at?: string | null;
  updated_at?: string | null;
};

/**
 * Fail-closed fallback used only when the live Billing Hub contract cannot be loaded.
 * It never claims acceptance or permits production delivery.
 */
export const RELATIONSHIP_ARCHITECTURE_FALLBACK: RelationshipArchitectureContract = {
  domain_key: RELATIONSHIP_DOMAIN_KEY,
  canonical_database: 'billing_hub_supabase',
  canonical_application: 'valorwell_crm',
  inbound_lane: 'creator_community_interest',
  outbound_lane: 'bty_relationship_outreach',
  clinical_campaign_lane: 'clinical_client_campaigns',
  clinical_campaign_boundary_enforced: true,
  implementation_status: 'production_hardened',
  terminology: {
    organization:
      'The entity being considered for Beyond The Yellow or another managed relationship.',
    contact:
      'The named person or role-based inbox used to communicate with an organization.',
    referral:
      'The factual provenance supporting how an organization or contact entered the relationship system.',
    bty_opportunity:
      'The specific Beyond The Yellow invitation opportunity linked to a broader relationship.',
    relationship:
      "ValorWell's broader intentionally managed connection to a person or organization.",
    campaign_enrollment:
      "A contact's participation in a relationship outreach sequence.",
  },
  contract_version: 1,
  schema_fingerprint: null,
  generated_type_hash: null,
  capability_manifest: {},
  object_inventory: {},
  rpc_signatures: [],
  grant_manifest: {},
  release_status: 'not_evaluated',
  activation_status: 'locked',
  activation_blockers: ['live_release_contract_unavailable'],
  acceptance_evidence: {},
  accepted_at: null,
};

export const RELATIONSHIP_MODULE_BOUNDARIES = {
  inbound: {
    label: 'Inbound Creator & Community Interest',
    route: '/crm/creator-community-interest',
    purpose:
      'Reviews website submissions, migrated interest records, and other people or organizations that initiated contact with ValorWell.',
  },
  outbound: {
    label: 'Business Development / BTY Outreach',
    route: '/crm/business-development',
    purpose:
      'Owns intentionally researched or referred organizations, named contacts, BTY invitation opportunities, direct outreach, and relationship follow-up.',
  },
  clinical: {
    label: 'Clinical Client Campaigns',
    route: '/crm/campaigns',
    purpose:
      'Communicates with clinical clients only. It must not be used for organizations, creators, partners, or BTY outreach targets.',
  },
} as const;
