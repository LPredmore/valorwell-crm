import { supabase } from '@/integrations/supabase/client';

export type BtyAutomationOrganization = {
  organizationId: string;
  name: string;
  website: string | null;
  headquartersState: string | null;
  subscriberCount: number | null;
  youtubeUrl: string | null;
  enrichmentStatus: string | null;
  enrichmentContactId: string | null;
};

export type BtyAutomationRun = {
  runId: string;
  businessDate: string;
  targetState: string;
  status: 'pending' | 'success' | 'failed' | string;
  attempt: number | null;
  model: string | null;
  organizationsCreatedCount: number | null;
  subscriberRangeTierUsed: string | null;
  startedAt: string | null;
  completedAt: string | null;
  notificationSentAt: string | null;
  errorSummary: Record<string, unknown> | null;
  organizations: BtyAutomationOrganization[];
};

export type BtyAutomationOverview = {
  state: {
    currentState?: string;
    nextState?: string;
    lastSuccessfulState?: string;
    lastSuccessfulBusinessDate?: string;
    updatedAt?: string;
  };
  runs: BtyAutomationRun[];
};

export type BtyDuplicateMember = {
  organizationId: string;
  name: string;
  website: string | null;
  headquartersState: string | null;
  roles: string[];
  createdAt: string;
};

export type BtyDuplicateGroup = {
  matchType: 'website_domain' | 'youtube_channel' | 'name_and_state' | 'exact_name' | string;
  matchKey: string;
  memberCount: number;
  survivorId: string;
  duplicateIds: string[] | null;
  members: BtyDuplicateMember[];
};

export type BtyAmbiguousDuplicate = {
  organizationId: string;
  name: string;
  similarTo: { organizationId: string; name: string };
  note: string;
};

export type BtyDuplicatePreview = {
  deterministic: BtyDuplicateGroup[];
  ambiguous: BtyAmbiguousDuplicate[];
};

async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function getBtyAutomationOverview(limit = 14) {
  return rpc<BtyAutomationOverview>('bty_automation_overview', { p_limit: limit });
}

export function previewBtyDuplicates() {
  return rpc<BtyDuplicatePreview>('bty_preview_organization_duplicates');
}

export function mergeBtyDuplicates(group: BtyDuplicateGroup, reason: string) {
  return rpc<Record<string, unknown>>('bty_merge_organization_duplicates', {
    p_survivor_id: group.survivorId,
    p_duplicate_ids: group.duplicateIds ?? [],
    p_reason: reason,
  });
}
