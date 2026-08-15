import { supabase } from '@/integrations/supabase/client';

export const AI_OPERATIONS_FLAGS = [
  'ai_operations_enabled',
  'system_integrity_enabled',
  'client_journey_ai_enabled',
  'communications_ai_enabled',
  'youtube_ai_enabled',
  'executive_brief_enabled',
  'executive_brief_email_enabled',
  'shadow_mode',
] as const;

export type AiOperationsFlagName = (typeof AI_OPERATIONS_FLAGS)[number];

export const AI_OPERATIONS_FLAG_LABELS: Record<AiOperationsFlagName, string> = {
  ai_operations_enabled: 'AI Operations platform',
  system_integrity_enabled: 'System Integrity module',
  client_journey_ai_enabled: 'Client Journey module',
  communications_ai_enabled: 'Communications QA module',
  youtube_ai_enabled: 'YouTube comment operations',
  executive_brief_enabled: 'Executive Brief generation',
  executive_brief_email_enabled: 'Executive Brief email delivery',
  shadow_mode: 'Shadow mode (observe only)',
};

export const AI_OPERATIONS_MODULES = [
  'system_integrity',
  'client_journey',
  'communications',
  'youtube',
  'executive_brief',
] as const;

export type AiOperationsModule = (typeof AI_OPERATIONS_MODULES)[number];

export const AI_OPERATIONS_MODULE_LABELS: Record<AiOperationsModule, string> = {
  system_integrity: 'System Integrity',
  client_journey: 'Client Journey',
  communications: 'Communications QA',
  youtube: 'YouTube',
  executive_brief: 'Executive Brief',
};

export type AiOperationsFlag = { flagName: string; enabled: boolean; updatedAt: string | null };

export type AiOperationsFinding = {
  id: string;
  module: string;
  fingerprint: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  summary: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number | null;
  recommendedAction: string | null;
  status: 'open' | 'snoozed' | 'resolved' | 'dismissed';
  firstDetectedAt: string;
  lastSeenAt: string;
  snoozedUntil: string | null;
  reopenCount: number;
  relatedExistingExceptionId: string | null;
  businessDate: string | null;
};

export type AiOperationsFindingPage = {
  total: number;
  limit: number;
  offset: number;
  items: AiOperationsFinding[];
};

export type AiOperationsModuleRun = {
  module: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  sourceItemsTotal: number;
  itemsAnalyzed: number;
  itemsReused: number;
  itemsFailed: number;
  coverage: Record<string, unknown>;
  model: string | null;
  errorCode: string | null;
  errorSummary: string | null;
};

export type AiOperationsOverview = {
  run: {
    id: string;
    businessDate: string;
    timezone: string;
    startedAt: string | null;
    sourceCutoffAt: string | null;
    completedAt: string | null;
    overallStatus: string;
    publicationStatus: string;
    coverageSummary: Record<string, unknown>;
  } | null;
  modules: AiOperationsModuleRun[];
  findingCounts: Record<string, number>;
  openFindingsByModule: Record<string, number>;
  brief: {
    id: string;
    businessDate: string;
    isPartial: boolean;
    status: string;
    generatedAt: string | null;
    publishedAt: string | null;
    emailStatus: string;
  } | null;
};

export type AiOperationsBrief = {
  id: string;
  businessDate: string;
  isPartial: boolean;
  status: string;
  sections: Array<{ key?: string; heading?: string; body?: string; severity?: string; itemCount?: number }>;
  coverageManifest: Record<string, unknown>;
  everythingNormal: string[];
  generatedAt: string | null;
  publishedAt: string | null;
  emailStatus: string;
  emailSentAt: string | null;
  model: string | null;
};

export type AiOperationsRunSummary = {
  id: string;
  businessDate: string;
  overallStatus: string;
  publicationStatus: string;
  startedAt: string | null;
  completedAt: string | null;
  sourceCutoffAt: string | null;
  coverageSummary: Record<string, unknown>;
  modules: Array<{ module: string; status: string; coverage: Record<string, unknown> }>;
};

export type AiOperationsYoutubeComment = {
  id: string;
  videoId: string;
  videoTitle: string | null;
  initiative: string | null;
  commentId: string;
  parentCommentId: string | null;
  authorDisplayName: string | null;
  commentText: string | null;
  publishedAt: string | null;
  classification: string | null;
  priority: string | null;
  suggestedReply: string | null;
  reviewState: string;
};

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchAiOperationsFlags = () => rpc<AiOperationsFlag[]>('ai_operations_list_flags');

export const setAiOperationsFlag = (flagName: string, enabled: boolean, reason: string) =>
  rpc<Record<string, unknown>>('ai_operations_set_flag', {
    p_flag_name: flagName,
    p_enabled: enabled,
    p_reason: reason,
  });

export const fetchAiOperationsOverview = (businessDate?: string | null) =>
  rpc<AiOperationsOverview>('ai_operations_overview', { p_business_date: businessDate ?? null });

export const fetchAiOperationsFindings = (options: {
  module?: string | null;
  status?: string | null;
  severity?: string | null;
  businessDate?: string | null;
  limit?: number;
  offset?: number;
} = {}) =>
  rpc<AiOperationsFindingPage>('ai_operations_list_findings', {
    p_module: options.module ?? null,
    p_status: options.status ?? 'open',
    p_severity: options.severity ?? null,
    p_business_date: options.businessDate ?? null,
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
  });

export const fetchAiOperationsRuns = (limit = 30) =>
  rpc<AiOperationsRunSummary[]>('ai_operations_list_runs', { p_limit: limit });

export const fetchAiOperationsBrief = (businessDate?: string | null) =>
  rpc<AiOperationsBrief | null>('ai_operations_get_brief', { p_business_date: businessDate ?? null });

export const fetchAiOperationsYoutubeComments = (reviewState?: string | null, limit = 50, offset = 0) =>
  rpc<{ total: number; items: AiOperationsYoutubeComment[] }>('ai_operations_list_youtube_comments', {
    p_review_state: reviewState ?? null,
    p_limit: limit,
    p_offset: offset,
  });

export const resolveAiOperationsFinding = (findingId: string, reason: string) =>
  rpc('ai_operations_resolve_finding', { p_finding_id: findingId, p_reason: reason });

export const dismissAiOperationsFinding = (findingId: string, reason: string) =>
  rpc('ai_operations_dismiss_finding', { p_finding_id: findingId, p_reason: reason });

export const snoozeAiOperationsFinding = (findingId: string, reason: string, snoozeUntil: string) =>
  rpc('ai_operations_snooze_finding', {
    p_finding_id: findingId,
    p_reason: reason,
    p_snooze_until: snoozeUntil,
  });

export const reopenAiOperationsFinding = (findingId: string, reason: string) =>
  rpc('ai_operations_reopen_finding', { p_finding_id: findingId, p_reason: reason });

/** A brief is only trustworthy when every module reported. */
export function briefCoverageIsComplete(overview: AiOperationsOverview | null | undefined): boolean {
  if (!overview?.modules?.length) return false;
  return overview.modules.every((module) => module.status === 'success');
}

export function severityRank(severity: string): number {
  switch (severity) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    default: return 3;
  }
}

export type SnoozePreset = { key: string; label: string; resolve: (now?: Date) => Date };

const addHours = (base: Date, hours: number) => new Date(base.getTime() + hours * 3_600_000);
const addDays = (base: Date, days: number) => new Date(base.getTime() + days * 86_400_000);

/** Snooze options offered in the dashboard. A snoozed finding leaves the active queue until it expires. */
export const AI_OPERATIONS_SNOOZE_PRESETS: SnoozePreset[] = [
  { key: 'later_today', label: 'Later today', resolve: (now = new Date()) => addHours(now, 4) },
  { key: 'tomorrow', label: 'Tomorrow', resolve: (now = new Date()) => addDays(now, 1) },
  { key: 'three_days', label: 'In 3 days', resolve: (now = new Date()) => addDays(now, 3) },
  { key: 'one_week', label: 'In 1 week', resolve: (now = new Date()) => addDays(now, 7) },
];

export function resolveSnoozeUntil(presetKey: string, now: Date = new Date()): Date | null {
  const preset = AI_OPERATIONS_SNOOZE_PRESETS.find((option) => option.key === presetKey);
  return preset ? preset.resolve(now) : null;
}

export type AiOperationsWidgetSummary = {
  businessDate: string | null;
  briefStatus: string;
  briefGeneratedAt: string | null;
  briefIsPartial: boolean;
  criticalCount: number;
  highCount: number;
  openCount: number;
  modules: Array<{ module: AiOperationsModule; label: string; status: string }>;
};

/** Compact, precomputed summary for the Operations Dashboard widget. */
export function buildAiOperationsWidgetSummary(
  overview: AiOperationsOverview | null | undefined,
): AiOperationsWidgetSummary {
  const counts = overview?.findingCounts ?? {};
  const openCount = Object.values(counts).reduce((total, value) => total + (Number(value) || 0), 0);
  const byModule = new Map((overview?.modules ?? []).map((module) => [module.module, module.status]));

  return {
    businessDate: overview?.run?.businessDate ?? null,
    briefStatus: overview?.brief?.status ?? 'unavailable',
    briefGeneratedAt: overview?.brief?.generatedAt ?? null,
    briefIsPartial: overview?.brief?.isPartial ?? false,
    criticalCount: Number(counts.critical ?? 0),
    highCount: Number(counts.high ?? 0),
    openCount,
    modules: (['system_integrity', 'client_journey', 'communications', 'youtube'] as const).map((module) => ({
      module,
      label: AI_OPERATIONS_MODULE_LABELS[module],
      status: byModule.get(module) ?? 'unknown',
    })),
  };
}
