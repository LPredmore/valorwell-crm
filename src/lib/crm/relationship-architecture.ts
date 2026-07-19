export const RELATIONSHIP_DOMAIN_KEY = 'business_development_relationships' as const;

export const RELATIONSHIP_ARCHITECTURE_FALLBACK = {
  domain_key: RELATIONSHIP_DOMAIN_KEY,
  canonical_database: 'billing_hub_supabase',
  canonical_application: 'valorwell_crm',
  inbound_lane: 'creator_community_interest',
  outbound_lane: 'bty_relationship_outreach',
  clinical_campaign_lane: 'clinical_client_campaigns',
  clinical_campaign_boundary_enforced: true,
  implementation_status: 'phase_1_established',
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
} as const;

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
  effective_at?: string | null;
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
