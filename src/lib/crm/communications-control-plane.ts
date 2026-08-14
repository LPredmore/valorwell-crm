import { supabase } from '@/integrations/supabase/client';

export const CONTROL_PLANE_FLAGS = [
  'communications_control_plane_enabled',
  'campaign_trigger_engine_enabled',
  'client_trigger_cutover_enabled',
  'bty_trigger_cutover_enabled',
  'staff_campaigns_enabled',
  'donor_campaigns_enabled',
  'universal_newsletters_enabled',
  'newsletter_mailbox_suppression_enabled',
] as const;

export type ControlPlaneFlagName = (typeof CONTROL_PLANE_FLAGS)[number];

export type ControlPlaneFlag = {
  flagName: ControlPlaneFlagName | string;
  enabled: boolean;
  updatedAt: string | null;
};

export type PersonIdentityOverview = {
  people: number;
  identities: number;
  linkedRecords: number;
  byDomain: Record<string, number>;
  linkedByDomain: Record<string, number>;
  crossDomainPeople: number;
};

export type PersonReconcileResult = {
  dryRun: boolean;
  peopleCreated: number;
  peopleReused: number;
  recordsLinked: number;
  recordsWithoutIdentifier: number;
};

export type CampaignParticipation = {
  enrollmentId: string;
  campaignDomain: 'client' | 'relationship' | string;
  engine: string;
  sourceCampaignId: string;
  campaignName: string | null;
  subjectDomain: string;
  subjectRecordId: string | null;
  personId: string | null;
  status: string | null;
  enrolledAt: string | null;
  completedAt: string | null;
  stepPosition: number | null;
};

export type CampaignRegistryEntry = {
  id: string;
  campaign_domain: string;
  engine: string;
  source_campaign_id: string;
  name: string;
  status: string;
  is_active: boolean;
};

/** Human labels for the staged implementation switches. */
export const CONTROL_PLANE_FLAG_LABELS: Record<string, string> = {
  communications_control_plane_enabled: 'Communications control plane',
  campaign_trigger_engine_enabled: 'Campaign trigger engine',
  client_trigger_cutover_enabled: 'Client trigger cutover',
  bty_trigger_cutover_enabled: 'BTY trigger cutover',
  staff_campaigns_enabled: 'Staff campaigns',
  donor_campaigns_enabled: 'Donor campaigns',
  universal_newsletters_enabled: 'Universal newsletters',
  newsletter_mailbox_suppression_enabled: 'Newsletter mailbox suppression',
};

/**
 * A cutover switch may only be turned on after the trigger engine itself is on.
 * Mirrors the database guard so the UI never offers an action the backend rejects.
 */
export function canEnableControlPlaneFlag(flagName: string, flags: ControlPlaneFlag[]): boolean {
  const engineOn = flags.some((flag) => flag.flagName === 'campaign_trigger_engine_enabled' && flag.enabled);
  if (flagName === 'client_trigger_cutover_enabled' || flagName === 'bty_trigger_cutover_enabled') {
    return engineOn;
  }
  return true;
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function listControlPlaneFlags() {
  return rpc<ControlPlaneFlag[]>('list_crm_control_plane_flags');
}

export function setControlPlaneFlag(flagName: string, enabled: boolean, reason: string) {
  return rpc<Record<string, unknown>>('set_crm_control_plane_flag', {
    p_flag_name: flagName,
    p_enabled: enabled,
    p_reason: reason,
  });
}

export function getPersonIdentityOverview() {
  return rpc<PersonIdentityOverview>('crm_person_identity_overview');
}

export function reconcilePersonIdentities(dryRun: boolean) {
  return rpc<PersonReconcileResult>('crm_reconcile_person_identities', { p_dry_run: dryRun });
}

export function getCampaignParticipation(filters: {
  personId?: string | null;
  campaignDomain?: string | null;
  sourceCampaignId?: string | null;
  status?: string | null;
  limit?: number;
} = {}) {
  return rpc<CampaignParticipation[]>('crm_campaign_participation', {
    p_person_id: filters.personId ?? null,
    p_campaign_domain: filters.campaignDomain ?? null,
    p_source_campaign_id: filters.sourceCampaignId ?? null,
    p_status: filters.status ?? null,
    p_limit: filters.limit ?? 200,
  });
}

export type CampaignTriggerRule = {
  ruleId: string;
  campaignRegistryId: string;
  campaignName: string | null;
  eventType: string;
  delayAmount: number;
  delayUnit: string;
  requiredSourceCampaignRegistryId: string | null;
  requiredSourceOutcome: string | null;
  active: boolean;
};

export type CampaignTriggerShadowRow = {
  jobId: string;
  ruleId: string | null;
  eventType: string | null;
  campaignName: string | null;
  status: string;
  decision: string | null;
  skipReason: string | null;
  dueAt: string | null;
  createdAt: string | null;
};

export function listCampaignTriggerRules() {
  return rpc<CampaignTriggerRule[]>('crm_list_campaign_trigger_rules');
}

export function getCampaignTriggerShadowReport(limit = 50) {
  return rpc<CampaignTriggerShadowRow[]>('crm_campaign_trigger_shadow_report', { p_limit: limit });
}

export function upsertCampaignTriggerRule(input: {
  ruleId?: string | null;
  campaignRegistryId: string;
  eventType: string;
  filterDefinition?: Record<string, unknown> | null;
  delayAmount?: number;
  delayUnit?: string;
  requiredSourceCampaignRegistryId?: string | null;
  requiredSourceOutcome?: string | null;
  active?: boolean;
  reason: string;
}) {
  return rpc<Record<string, unknown>>('crm_upsert_campaign_trigger_rule', {
    p_rule_id: input.ruleId ?? null,
    p_campaign_registry_id: input.campaignRegistryId,
    p_event_type: input.eventType,
    p_filter_definition: input.filterDefinition ?? {},
    p_delay_amount: input.delayAmount ?? 0,
    p_delay_unit: input.delayUnit ?? 'minutes',
    p_required_source_campaign_registry_id: input.requiredSourceCampaignRegistryId ?? null,
    p_required_source_outcome: input.requiredSourceOutcome ?? null,
    p_active: input.active ?? true,
    p_reason: input.reason,
  });
}

export async function listCampaignRegistry() {
  const { data, error } = await (supabase.from as unknown as (
    table: string,
  ) => {
    select: (columns: string) => {
      order: (column: string) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  })('crm_campaign_registry')
    .select('id, campaign_domain, engine, source_campaign_id, name, status, is_active')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as CampaignRegistryEntry[];
}

