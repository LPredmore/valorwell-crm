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

export type BtyDuplicateGroup = {
  matchType: string;
  matchValue: string;
  keepOrganizationId: string;
  keepName: string;
  mergeOrganizationIds: string[];
  mergeNames: string[];
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
  return rpc<BtyDuplicateGroup[]>('bty_preview_organization_duplicates');
}

export function mergeBtyDuplicates(group: BtyDuplicateGroup, reason: string) {
  return rpc<Record<string, unknown>>('bty_merge_organization_duplicates', {
    p_keep_organization_id: group.keepOrganizationId,
    p_merge_organization_ids: group.mergeOrganizationIds,
    p_reason: reason,
  });
}
