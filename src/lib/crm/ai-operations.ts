import { supabase } from '@/integrations/supabase/client';

export const AI_OPERATIONS_FLAGS = [
  'ai_operations_enabled',
  'system_integrity_enabled',
  'user_flow_smoke_enabled',
  'client_journey_monitoring_enabled',
  'staff_workflow_monitoring_enabled',
  'appointment_integrity_monitoring_enabled',
  'billing_claims_monitoring_enabled',
  'data_quality_monitoring_enabled',
  'relationship_followup_monitoring_enabled',
  'sop_compliance_monitoring_enabled',
  'client_journey_ai_enabled',
  'communications_ai_enabled',
  'donor_intelligence_ai_enabled',
  'social_leads_ai_enabled',
  'content_performance_ai_enabled',
  'bty_intelligence_ai_enabled',
  'weekly_patterns_ai_enabled',
  'youtube_ai_enabled',
  'executive_brief_enabled',
  'executive_brief_email_enabled',
  'shadow_mode',
] as const;

export type AiOperationsFlagName = (typeof AI_OPERATIONS_FLAGS)[number];

export const AI_OPERATIONS_FLAG_LABELS: Record<AiOperationsFlagName, string> = {
  ai_operations_enabled: 'ValorWell Daily monitoring',
  system_integrity_enabled: 'System Integrity monitoring',
  user_flow_smoke_enabled: 'Critical user-flow monitoring',
  client_journey_monitoring_enabled: 'Client Journey monitoring',
  staff_workflow_monitoring_enabled: 'Staff Workflow monitoring',
  appointment_integrity_monitoring_enabled: 'Appointment Integrity monitoring',
  billing_claims_monitoring_enabled: 'Billing & Claims monitoring',
  data_quality_monitoring_enabled: 'Data Quality monitoring',
  relationship_followup_monitoring_enabled: 'Relationship Follow-up monitoring',
  sop_compliance_monitoring_enabled: 'SOP Compliance monitoring',
  client_journey_ai_enabled: 'Manual Client Journey AI review',
  communications_ai_enabled: 'Manual Communications QA',
  donor_intelligence_ai_enabled: 'Manual Donor Intelligence',
  social_leads_ai_enabled: 'Manual Social Leads analysis',
  content_performance_ai_enabled: 'Manual Content Performance analysis',
  bty_intelligence_ai_enabled: 'Manual Beyond The Yellow analysis',
  weekly_patterns_ai_enabled: 'Manual Weekly Pattern analysis',
  youtube_ai_enabled: 'Manual YouTube comment analysis',
  executive_brief_enabled: 'Daily deterministic summary',
  executive_brief_email_enabled: 'Daily summary email delivery',
  shadow_mode: 'Observe-only mode',
};

export const AI_OPERATIONS_MODULES = [
  'system_integrity',
  'user_flow_smoke',
  'client_journey',
  'communications',
  'staff_quality',
  'appointment_integrity',
  'billing_claims',
  'data_quality',
  'relationship_followup',
  'donor_intelligence',
  'social_leads',
  'content_performance',
  'bty_intelligence',
  'sop_compliance',
  'weekly_patterns',
  'youtube',
  'executive_brief',
] as const;

export type AiOperationsModule = (typeof AI_OPERATIONS_MODULES)[number];

export const AI_OPERATIONS_AUTOMATIC_MODULES = [
  'system_integrity',
  'user_flow_smoke',
  'client_journey',
  'staff_quality',
  'appointment_integrity',
  'billing_claims',
  'data_quality',
  'relationship_followup',
  'sop_compliance',
] as const satisfies readonly AiOperationsModule[];

export const AI_OPERATIONS_MANUAL_MODULES = [
  'communications',
  'donor_intelligence',
  'social_leads',
  'content_performance',
  'bty_intelligence',
  'weekly_patterns',
  'youtube',
] as const satisfies readonly AiOperationsModule[];

const AI_OPERATIONS_MANUAL_MODULE_SET = new Set<string>(AI_OPERATIONS_MANUAL_MODULES);
export function isAiOperationsManualModule(module: string): boolean {
  return AI_OPERATIONS_MANUAL_MODULE_SET.has(module);
}

export const AI_OPERATIONS_MODULE_LABELS: Record<AiOperationsModule, string> = {
  system_integrity: 'System Integrity',
  user_flow_smoke: 'User-flow smoke tests',
  client_journey: 'Client Journey',
  communications: 'Communications QA (manual)',
  staff_quality: 'Staff Workflow',
  appointment_integrity: 'Appointment Integrity',
  billing_claims: 'Billing & Claims',
  data_quality: 'Data Quality',
  relationship_followup: 'Relationship Follow-up',
  donor_intelligence: 'Donor Intelligence (manual)',
  social_leads: 'Social Leads (manual)',
  content_performance: 'Content Performance (manual)',
  bty_intelligence: 'BTY Intelligence (manual)',
  sop_compliance: 'SOP Compliance',
  weekly_patterns: 'Weekly Patterns (manual)',
  youtube: 'YouTube (manual)',
  executive_brief: 'Daily Summary',
};

export type AiOperationsFlag = { flagName: string; enabled: boolean; updatedAt: string | null };
export type AiOperationsFinding = {
  id: string; module: string; fingerprint: string; mode: 'automatic' | 'manual'; entityType: string | null; entityId: string | null;
  title: string; summary: string | null; severity: 'critical' | 'high' | 'medium' | 'low'; confidence: number | null;
  recommendedAction: string | null; status: 'open' | 'snoozed' | 'resolved' | 'dismissed'; firstDetectedAt: string;
  lastSeenAt: string; snoozedUntil: string | null; reopenCount: number; relatedExistingExceptionId: string | null; businessDate: string | null;
  evidence: unknown; evidenceObservedAt: string | null;
};
export type AiOperationsFindingPage = { total: number; limit: number; offset: number; items: AiOperationsFinding[] };
export type AiOperationsModuleRun = {
  module: string; status: string; startedAt: string | null; completedAt: string | null; sourceItemsTotal: number;
  itemsAnalyzed: number; itemsReused: number; itemsFailed: number; coverage: Record<string, unknown>; model: string | null;
  errorCode: string | null; errorSummary: string | null;
};
export type AiOperationsOverview = {
  run: { id: string; businessDate: string; timezone: string; startedAt: string | null; sourceCutoffAt: string | null; completedAt: string | null; overallStatus: string; publicationStatus: string; coverageSummary: Record<string, unknown> } | null;
  modules: AiOperationsModuleRun[];
  findingCounts: Record<string, number>;
  automaticFindingCounts: Record<string, number>;
  manualFindingCounts: Record<string, number>;
  automaticOpenCount: number;
  manualOpenCount: number;
  openFindingsByModule: Record<string, number>;
  automaticOpenFindingsByModule: Record<string, number>;
  manualOpenFindingsByModule: Record<string, number>;
  brief: { id: string; businessDate: string; isPartial: boolean; status: string; generatedAt: string | null; publishedAt: string | null; emailStatus: string } | null;
};
export type AiOperationsBrief = {
  id: string; businessDate: string; isPartial: boolean; status: string;
  sections: Array<{ key?: string; heading?: string; body?: string; severity?: string; itemCount?: number }>;
  coverageManifest: Record<string, unknown>; everythingNormal: string[]; generatedAt: string | null; publishedAt: string | null;
  emailStatus: string; emailSentAt: string | null; model: string | null;
};
export type AiOperationsRunSummary = {
  id: string; businessDate: string; overallStatus: string; publicationStatus: string; startedAt: string | null; completedAt: string | null;
  sourceCutoffAt: string | null; coverageSummary: Record<string, unknown>; modules: Array<{ module: string; status: string; coverage: Record<string, unknown> }>;
};
export type AiOperationsYoutubeComment = {
  id: string; videoId: string; videoTitle: string | null; initiative: string | null; commentId: string; parentCommentId: string | null;
  authorDisplayName: string | null; commentText: string | null; publishedAt: string | null; classification: string | null;
  priority: string | null; suggestedReply: string | null; reviewState: string;
};
export type AiWeeklyReview = { id: string; week_ending: string; structured_result: { weekSummary?: string; patterns?: Array<Record<string, unknown>>; gaps?: string[] }; created_at: string };
export type AiBtyBrief = { id: string; business_date: string; brief_type: 'prep' | 'post_interview'; source_sufficient: boolean; structured_result: Record<string, unknown>; meeting_id: string | null; created_at: string };

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchAiOperationsFlags = () => rpc<AiOperationsFlag[]>('ai_operations_list_flags');
export const setAiOperationsFlag = (flagName: string, enabled: boolean, reason: string) => rpc<Record<string, unknown>>('ai_operations_set_flag', { p_flag_name: flagName, p_enabled: enabled, p_reason: reason });
export const fetchAiOperationsOverview = (businessDate?: string | null) => rpc<AiOperationsOverview>('ai_operations_overview', { p_business_date: businessDate ?? null });
export const fetchAiOperationsFindings = (options: { module?: string | null; status?: string | null; severity?: string | null; businessDate?: string | null; mode?: 'automatic' | 'manual' | 'all' | null; limit?: number; offset?: number } = {}) => rpc<AiOperationsFindingPage>('ai_operations_list_findings_v2', { p_module: options.module ?? null, p_status: options.status ?? 'open', p_severity: options.severity ?? null, p_business_date: options.businessDate ?? null, p_mode: options.mode ?? null, p_limit: options.limit ?? 50, p_offset: options.offset ?? 0 });
export const fetchAiOperationsRuns = (limit = 30) => rpc<AiOperationsRunSummary[]>('ai_operations_list_runs', { p_limit: limit });
export const fetchAiOperationsBrief = (businessDate?: string | null) => rpc<AiOperationsBrief | null>('ai_operations_get_brief', { p_business_date: businessDate ?? null });
export const fetchAiOperationsYoutubeComments = (reviewState?: string | null, limit = 50, offset = 0) => rpc<{ total: number; items: AiOperationsYoutubeComment[] }>('ai_operations_list_youtube_comments', { p_review_state: reviewState ?? null, p_limit: limit, p_offset: offset });
export const resolveAiOperationsFinding = (findingId: string, reason: string) => rpc('ai_operations_resolve_finding', { p_finding_id: findingId, p_reason: reason });
export const dismissAiOperationsFinding = (findingId: string, reason: string) => rpc('ai_operations_dismiss_finding', { p_finding_id: findingId, p_reason: reason });
export const snoozeAiOperationsFinding = (findingId: string, reason: string, snoozeUntil: string) => rpc('ai_operations_snooze_finding', { p_finding_id: findingId, p_reason: reason, p_snooze_until: snoozeUntil });
export const reopenAiOperationsFinding = (findingId: string, reason: string) => rpc('ai_operations_reopen_finding', { p_finding_id: findingId, p_reason: reason });

export async function fetchAiWeeklyReviews(limit = 8): Promise<AiWeeklyReview[]> {
  const { data, error } = await supabase.from('ai_operations_weekly_reviews').select('*').order('week_ending', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AiWeeklyReview[];
}
export async function fetchAiBtyBriefs(limit = 20): Promise<AiBtyBrief[]> {
  const { data, error } = await supabase.from('ai_operations_bty_briefs').select('*').order('business_date', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AiBtyBrief[];
}

export function briefCoverageIsComplete(overview: AiOperationsOverview | null | undefined): boolean {
  if (!overview?.modules?.length) return false;
  return overview.modules.filter((module) => AI_OPERATIONS_AUTOMATIC_MODULES.includes(module.module as (typeof AI_OPERATIONS_AUTOMATIC_MODULES)[number])).every((module) => module.status === 'success');
}
export function severityRank(severity: string): number { switch (severity) { case 'critical': return 0; case 'high': return 1; case 'medium': return 2; default: return 3; } }
export type SnoozePreset = { key: string; label: string; resolve: (now?: Date) => Date };
const addHours = (base: Date, hours: number) => new Date(base.getTime() + hours * 3_600_000);
const addDays = (base: Date, days: number) => new Date(base.getTime() + days * 86_400_000);
export const AI_OPERATIONS_SNOOZE_PRESETS: SnoozePreset[] = [
  { key: 'later_today', label: 'Later today', resolve: (now = new Date()) => addHours(now, 4) },
  { key: 'tomorrow', label: 'Tomorrow', resolve: (now = new Date()) => addDays(now, 1) },
  { key: 'three_days', label: 'In 3 days', resolve: (now = new Date()) => addDays(now, 3) },
  { key: 'one_week', label: 'In 1 week', resolve: (now = new Date()) => addDays(now, 7) },
];
export function resolveSnoozeUntil(presetKey: string, now: Date = new Date()): Date | null { const preset = AI_OPERATIONS_SNOOZE_PRESETS.find((option) => option.key === presetKey); return preset ? preset.resolve(now) : null; }

export type AiOperationsWidgetSummary = {
  businessDate: string | null; briefStatus: string; briefGeneratedAt: string | null; briefIsPartial: boolean;
  criticalCount: number; highCount: number; openCount: number; modules: Array<{ module: AiOperationsModule; label: string; status: string }>;
};
export function buildAiOperationsWidgetSummary(overview: AiOperationsOverview | null | undefined): AiOperationsWidgetSummary {
  const counts = overview?.automaticFindingCounts ?? overview?.findingCounts ?? {};
  const openCount = overview?.automaticOpenCount ?? Object.values(counts).reduce((total, value) => total + (Number(value) || 0), 0);
  const byModule = new Map((overview?.modules ?? []).map((module) => [module.module, module.status]));
  return {
    businessDate: overview?.run?.businessDate ?? null,
    briefStatus: overview?.brief?.status ?? 'unavailable', briefGeneratedAt: overview?.brief?.generatedAt ?? null,
    briefIsPartial: overview?.brief?.isPartial ?? false, criticalCount: Number(counts.critical ?? 0), highCount: Number(counts.high ?? 0), openCount,
    modules: AI_OPERATIONS_AUTOMATIC_MODULES.map((module) => ({ module, label: AI_OPERATIONS_MODULE_LABELS[module], status: byModule.get(module) ?? 'unknown' })),
  };
}

export type AiSmokeResult = {
  id: string;
  flow_key: string;
  display_name: string;
  domain: string;
  status: 'healthy' | 'failing' | 'unknown' | 'error';
  broken_count: number;
  source_count: number;
  sample: unknown;
  error_message: string | null;
  checked_at: string;
};

/** Latest smoke-test outcome per critical flow. Deterministic, never model-generated. */
export async function fetchAiSmokeResults(limit = 60): Promise<AiSmokeResult[]> {
  const { data, error } = await supabase
    .from('ai_operations_smoke_results')
    .select('*')
    .order('checked_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as AiSmokeResult[];
  const latest = new Map<string, AiSmokeResult>();
  for (const row of rows) if (!latest.has(row.flow_key)) latest.set(row.flow_key, row);
  return [...latest.values()].sort((a, b) => a.flow_key.localeCompare(b.flow_key));
}
