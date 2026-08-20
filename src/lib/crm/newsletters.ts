import { supabase } from '@/integrations/supabase/client';
import type { EmailContentDocument, EmailEditorDocument } from '@/features/email-studio/contracts';

export const NEWSLETTER_AUDIENCE_DOMAINS = ['client', 'staff', 'donor', 'bty'] as const;
export type NewsletterAudienceDomain = (typeof NEWSLETTER_AUDIENCE_DOMAINS)[number];

export const NEWSLETTER_AUDIENCE_LABELS: Record<NewsletterAudienceDomain, string> = {
  client: 'Clients',
  staff: 'Staff',
  donor: 'Donors',
  bty: 'Beyond The Yellow contacts',
};

export type NewsletterRuntimeState = 'PRELAUNCH' | 'PAUSED' | 'ACTIVE';

export type NewsletterReadiness = {
  runtimeState: NewsletterRuntimeState;
  canActivate: boolean;
  checks: {
    senderConfigured: boolean;
    workerReleaseMarked: boolean;
    schedulerPresent: boolean;
    workerRpcLeastPrivilege: boolean;
    communicationsControlPlaneEnabled: boolean;
    inFlightRecipients: number;
    suppressionInvariant: boolean;
    supportedAudiences: NewsletterAudienceDomain[];
  };
};

export type NewsletterRuntime = {
  state: NewsletterRuntimeState;
  reason: string | null;
  workerRelease: string | null;
  workerDeployedAt: string | null;
  schedulerInstalledAt: string | null;
  activationVerifiedAt: string | null;
  updatedAt: string | null;
  readiness: NewsletterReadiness;
};

export type NewsletterSummary = {
  id: string;
  name: string;
  subject: string | null;
  status: 'draft' | 'scheduled' | 'sending' | 'completed' | 'cancelled' | string;
  canonical: boolean;
  audienceDomains: NewsletterAudienceDomain[];
  scheduledAt: string | null;
  queued: number;
  processing: number;
  sent: number;
  failed: number;
  suppressed: number;
  skipped: number;
  updatedAt: string | null;
};

export type NewsletterOverview = {
  newsletters: NewsletterSummary[];
  suppressedMailboxes: number;
};

export type NewsletterDetail = {
  id: string;
  name: string;
  subject: string | null;
  preheader: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  editorDocument: EmailEditorDocument | null;
  schemaVersion: number | null;
  themeKey: string | null;
  renderHash: string | null;
  templateVersionId: string | null;
  canonical: boolean;
  audienceDomains: NewsletterAudienceDomain[];
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
  sample: Array<{ email: string; audiences: NewsletterAudienceDomain[]; suppressed: boolean }>;
};

export type NewsletterTraceRecipient = {
  recipientId: string;
  deliveryEmail: string;
  mailboxKey: string;
  personId: string | null;
  qualifyingAudiences: NewsletterAudienceDomain[];
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

async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function getNewsletterRuntime() {
  return rpc<NewsletterRuntime>('crm_get_newsletter_runtime');
}

export function setNewsletterRuntime(state: NewsletterRuntimeState, reason: string) {
  return rpc<{ previousState: NewsletterRuntimeState; state: NewsletterRuntimeState }>('crm_set_newsletter_runtime', {
    p_state: state,
    p_reason: reason,
  });
}

export function listNewsletters() {
  return rpc<NewsletterOverview>('crm_list_newsletters');
}

export function getNewsletter(newsletterId: string) {
  return rpc<NewsletterDetail>('crm_get_newsletter', { p_newsletter_id: newsletterId });
}

export function previewNewsletterAudience(audienceDomains: NewsletterAudienceDomain[], sampleLimit = 10) {
  return rpc<NewsletterAudiencePreview>('crm_newsletter_audience_preview', {
    p_audience_domains: audienceDomains,
    p_sample_limit: sampleLimit,
  });
}

export function upsertCanonicalNewsletter(input: {
  newsletterId?: string | null;
  name: string;
  subject: string;
  content: EmailContentDocument;
  audienceDomains: NewsletterAudienceDomain[];
  reason: string;
  templateVersionId?: string | null;
}) {
  return rpc<{ newsletterId: string; created: boolean; canonical: boolean; renderHash: string }>(
    'crm_upsert_newsletter_canonical',
    {
      p_newsletter_id: input.newsletterId ?? null,
      p_name: input.name,
      p_subject: input.subject,
      p_content: input.content,
      p_audience_domains: input.audienceDomains,
      p_reason: input.reason,
      p_template_version_id: input.templateVersionId ?? null,
    },
  );
}

export function scheduleNewsletter(input: { newsletterId: string; scheduledAt?: string | null; reason: string }) {
  return rpc<{
    newsletterId: string;
    status: string;
    scheduledAt: string;
    pendingRecipients: number;
    suppressedRecipients: number;
  }>('crm_schedule_newsletter', {
    p_newsletter_id: input.newsletterId,
    p_scheduled_at: input.scheduledAt ?? null,
    p_reason: input.reason,
  });
}

export function cancelNewsletterSend(input: { newsletterId: string; reason: string }) {
  return rpc<{ newsletterId: string; status: string; stoodDownRecipients: number }>('crm_cancel_newsletter_send', {
    p_newsletter_id: input.newsletterId,
    p_reason: input.reason,
  });
}

export function cloneNewsletterToDraft(input: { newsletterId: string; name: string; reason: string }) {
  return rpc<{ newsletterId: string; revisedFromNewsletterId: string; status: 'draft' }>(
    'crm_clone_newsletter_to_draft',
    {
      p_newsletter_id: input.newsletterId,
      p_name: input.name,
      p_reason: input.reason,
    },
  );
}

export function suppressNewsletterMailbox(input: { email: string; reason: string; source?: string }) {
  return rpc<{ mailboxKey: string; reasonCode: string; active: boolean }>('crm_suppress_newsletter_mailbox', {
    p_email: input.email,
    p_reason: input.reason,
    p_source: input.source ?? 'operator',
  });
}

export function unsuppressNewsletterMailbox(input: { email: string; reason: string }) {
  return rpc<{ mailboxKey: string; changed: boolean }>('crm_unsuppress_newsletter_mailbox', {
    p_email: input.email,
    p_reason: input.reason,
  });
}

export function getNewsletterDeliveryTrace(newsletterId: string, limit = 200) {
  return rpc<NewsletterDeliveryTrace>('crm_newsletter_delivery_trace', {
    p_newsletter_id: newsletterId,
    p_limit: limit,
  });
}

export function detailToCanonicalContent(detail: NewsletterDetail): EmailContentDocument | null {
  if (!detail.canonical || !detail.editorDocument || !detail.schemaVersion || !detail.themeKey || !detail.renderHash) {
    return null;
  }
  return {
    schemaVersion: detail.schemaVersion,
    mode: 'newsletter',
    editorDocument: detail.editorDocument,
    renderedHtml: detail.bodyHtml ?? '',
    renderedText: detail.bodyText ?? '',
    preheader: detail.preheader,
    themeKey: detail.themeKey,
    renderHash: detail.renderHash,
  };
}
