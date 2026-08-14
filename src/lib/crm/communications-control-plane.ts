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
  id: string;
  campaignRegistryId: string;
  campaignName: string | null;
  campaignDomain: string;
  concurrencyGroup: string | null;
  eventType: string;
  filterDefinition: Record<string, unknown> | null;
  delayAmount: number;
  delayUnit: string;
  requiredSourceCampaignRegistryId: string | null;
  requiredSourceOutcome: string | null;
  active: boolean;
  version: number;
  updatedAt: string | null;
};

export type CampaignTriggerShadowReport = {
  summary: Array<{ status: string; skipReason: string | null; count: number }>;
  recent: Array<{
    jobId: string;
    eventType: string | null;
    subjectType: string | null;
    subjectId: string | null;
    campaignName: string | null;
    status: string;
    skipReason: string | null;
    dueAt: string | null;
    wouldEnroll: boolean;
    enrollmentId: string | null;
    createdAt: string | null;
  }>;
};

export function listCampaignTriggerRules() {
  return rpc<CampaignTriggerRule[]>('crm_list_campaign_trigger_rules');
}

export function getCampaignTriggerShadowReport(limit = 50) {
  return rpc<CampaignTriggerShadowReport>('crm_campaign_trigger_shadow_report', { p_limit: limit });
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


export type AudienceCampaign = {
  id: string;
  audienceDomain: 'staff' | 'donor';
  name: string;
  description: string | null;
  status: string;
  stepCount: number;
  activeEnrollments: number;
  updatedAt: string | null;
};

export type NewsletterSummary = {
  id: string;
  name: string;
  subject: string | null;
  status: string;
  audienceDomains: string[];
  scheduledAt: string | null;
  queued: number;
  processing: number;
  sent: number;
  failed: number;
  suppressed: number;
  updatedAt: string | null;
};

export type NewsletterOverview = {
  newsletters: NewsletterSummary[];
  suppressedMailboxes: number;
};

export function listAudienceCampaigns() {
  return rpc<AudienceCampaign[]>('crm_list_audience_campaigns');
}

export function listNewsletters() {
  return rpc<NewsletterOverview>('crm_list_newsletters');
}

export function upsertAudienceCampaign(input: {
  campaignId?: string | null;
  audienceDomain: 'staff' | 'donor';
  name: string;
  description?: string | null;
  status?: 'draft' | 'active' | 'paused' | 'archived';
  reason: string;
}) {
  return rpc<Record<string, unknown>>('crm_upsert_audience_campaign', {
    p_campaign_id: input.campaignId ?? null,
    p_audience_domain: input.audienceDomain,
    p_name: input.name,
    p_description: input.description ?? null,
    p_status: input.status ?? 'draft',
    p_reason: input.reason,
  });
}

export function enrollPeopleInAudienceCampaign(input: {
  campaignId: string;
  personIds: string[];
  reason: string;
}) {
  return rpc<Record<string, unknown>>('crm_enroll_people_in_audience_campaign', {
    p_campaign_id: input.campaignId,
    p_person_ids: input.personIds,
    p_reason: input.reason,
  });
}

export function suppressNewsletterMailbox(input: { email: string; reason: string; source?: string }) {
  return rpc<Record<string, unknown>>('crm_suppress_newsletter_mailbox', {
    p_email: input.email,
    p_reason: input.reason,
    p_source: input.source ?? 'operator',
  });
}

export function buildNewsletterRecipients(input: { newsletterId: string; reason: string }) {
  return rpc<Record<string, unknown>>('crm_build_newsletter_recipients', {
    p_newsletter_id: input.newsletterId,
    p_reason: input.reason,
  });
}

export function scheduleNewsletter(input: { newsletterId: string; scheduledAt?: string | null; reason: string }) {
  return rpc<{ newsletterId: string; status: string; scheduledAt: string; pendingRecipients: number }>(
    'crm_schedule_newsletter',
    {
      p_newsletter_id: input.newsletterId,
      p_scheduled_at: input.scheduledAt ?? null,
      p_reason: input.reason,
    },
  );
}

export function cancelNewsletterSend(input: { newsletterId: string; reason: string }) {
  return rpc<{ newsletterId: string; status: string; stoodDownRecipients: number }>(
    'crm_cancel_newsletter_send',
    { p_newsletter_id: input.newsletterId, p_reason: input.reason },
  );
}



export type NewsletterTraceRecipient = {
  recipientId: string;
  deliveryEmail: string;
  mailboxKey: string;
  personId: string | null;
  qualifyingAudiences: string[];
  sourceMemberships: Array<{ domain: string; recordId: string | null; personId: string | null; email: string }>;
  recipientStatus: string;
  suppressionReason: string | null;
  attemptCount: number;
  errorCode: string | null;
  emailMessageId: string | null;
  ledgerStatus: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
};

export type NewsletterDeliveryTrace = {
  newsletterId: string;
  summary: Array<{ status: string; count: number }>;
  recipients: NewsletterTraceRecipient[];
};

export function getNewsletterDeliveryTrace(newsletterId: string, limit = 200) {
  return rpc<NewsletterDeliveryTrace>('crm_newsletter_delivery_trace', {
    p_newsletter_id: newsletterId,
    p_limit: limit,
  });
}

export const NEWSLETTER_AUDIENCE_DOMAINS = [
  'client',
  'staff',
  'donor',
  'relationship',
  'bty',
  'provider_applicant',
] as const;

export type NewsletterAudienceDomain = (typeof NEWSLETTER_AUDIENCE_DOMAINS)[number];

export const NEWSLETTER_AUDIENCE_LABELS: Record<string, string> = {
  client: 'Clients',
  staff: 'Staff',
  donor: 'Donors',
  relationship: 'Relationship contacts',
  bty: 'Beyond The Yellow contacts',
  provider_applicant: 'Provider applicants',
};

export type NewsletterDetail = {
  id: string;
  name: string;
  subject: string | null;
  preheader: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  audienceDomains: string[];
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  recipientCounts: Record<string, number>;
};

export type NewsletterAudiencePreview = {
  uniqueMailboxes: number;
  suppressedMailboxes: number;
  deliverableMailboxes: number;
  overlapMailboxes: number;
  byDomain: Record<string, number>;
  sample: Array<{ email: string; audiences: string[]; suppressed: boolean }>;
};

export function getNewsletter(newsletterId: string) {
  return rpc<NewsletterDetail>('crm_get_newsletter', { p_newsletter_id: newsletterId });
}

export function previewNewsletterAudience(audienceDomains: string[], sampleLimit = 10) {
  return rpc<NewsletterAudiencePreview>('crm_newsletter_audience_preview', {
    p_audience_domains: audienceDomains,
    p_sample_limit: sampleLimit,
  });
}

export function upsertNewsletter(input: {
  newsletterId?: string | null;
  name: string;
  subject?: string | null;
  preheader?: string | null;
  bodyHtml?: string | null;
  bodyText?: string | null;
  audienceDomains: string[];
  reason: string;
}) {
  return rpc<{ newsletterId: string; created: boolean }>('crm_upsert_newsletter', {
    p_newsletter_id: input.newsletterId ?? null,
    p_name: input.name,
    p_subject: input.subject ?? null,
    p_preheader: input.preheader ?? null,
    p_body_html: input.bodyHtml ?? null,
    p_body_text: input.bodyText ?? null,
    p_audience_domains: input.audienceDomains,
    p_reason: input.reason,
  });
}

export type CommunicationsObservability = {
  windowDays: number;
  generatedAt: string;
  queueDepth: {
    triggerJobsPending: number;
    triggerJobsOverdue: number;
    automationEventsUnprocessed: number;
    audienceEnrollmentsDue: number;
    newsletterRecipientsPending: number;
    newsletterRecipientsClaimed: number;
    newslettersSending: number;
    newslettersScheduled: number;
  };
  failureRates: {
    triggerJobs: { total: number; failed: number; rate: number };
    audienceSteps: { total: number; failed: number; rate: number };
    newsletterRecipients: { total: number; failed: number; bounced: number; sent: number; rate: number };
  };
  suppressionGrowth: {
    total: number;
    addedInWindow: number;
    daily: Array<{ day: string; added: number }>;
    byReason: Record<string, number>;
  };
};

export function getCommunicationsObservability(windowDays = 7) {
  return rpc<CommunicationsObservability>('crm_communications_observability', {
    p_window_days: windowDays,
  });
}
