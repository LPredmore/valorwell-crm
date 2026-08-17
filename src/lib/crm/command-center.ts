import { supabase } from '@/integrations/supabase/client';

/**
 * Phase 6 — Daily Command Center.
 *
 * This module is a read/aggregate layer over the findings that Phases 1-5 already
 * produce. It never triggers analysis: every fetch here reads previously generated
 * rows through the tenant-scoped, admin-gated Command Center RPCs.
 */

export const COMMAND_CENTER_CATEGORIES = [
  'client_care',
  'staff',
  'appointments',
  'billing',
  'communications',
  'relationships',
  'donors_growth',
  'beyond_the_yellow',
  'marketing_content',
  'data_quality',
  'compliance_sop',
  'system_health',
] as const;

export type CommandCenterCategory = (typeof COMMAND_CENTER_CATEGORIES)[number];

export const COMMAND_CENTER_CATEGORY_LABELS: Record<CommandCenterCategory, string> = {
  client_care: 'Client Care',
  staff: 'Staff',
  appointments: 'Appointments',
  billing: 'Billing',
  communications: 'Communications',
  relationships: 'Relationships',
  donors_growth: 'Donors / Growth',
  beyond_the_yellow: 'Beyond The Yellow',
  marketing_content: 'Marketing / Content',
  data_quality: 'Data Quality',
  compliance_sop: 'Compliance / SOP',
  system_health: 'System Health',
};

/** Mirrors private.ai_ops_finding_category so the UI can label without another round trip. */
export function categoryForModule(module: string): CommandCenterCategory {
  switch (module) {
    case 'client_journey': return 'client_care';
    case 'staff_quality': return 'staff';
    case 'appointment_integrity': return 'appointments';
    case 'billing_claims': return 'billing';
    case 'communications': return 'communications';
    case 'relationship_followup': return 'relationships';
    case 'donor_intelligence': return 'donors_growth';
    case 'bty_intelligence': return 'beyond_the_yellow';
    case 'social_leads':
    case 'content_opportunities':
    case 'content_performance': return 'marketing_content';
    case 'data_quality': return 'data_quality';
    case 'sop_compliance': return 'compliance_sop';
    default: return 'system_health';
  }
}

export const COMMAND_CENTER_VIEWS = ['active', 'mine', 'snoozed', 'resolved', 'all'] as const;
export type CommandCenterView = (typeof COMMAND_CENTER_VIEWS)[number];
export const COMMAND_CENTER_VIEW_LABELS: Record<CommandCenterView, string> = {
  active: 'Active', mine: 'Mine', snoozed: 'Snoozed', resolved: 'Resolved', all: 'All',
};

export type CommandCenterStatus = 'open' | 'reviewed' | 'assigned' | 'in_progress' | 'snoozed' | 'resolved' | 'dismissed';
export const COMMAND_CENTER_STATUS_LABELS: Record<CommandCenterStatus, string> = {
  open: 'New', reviewed: 'Reviewed', assigned: 'Assigned', in_progress: 'In progress',
  snoozed: 'Snoozed', resolved: 'Resolved', dismissed: 'Dismissed',
};

export type CommandCenterFinding = {
  id: string; module: string; category: CommandCenterCategory; fingerprint: string;
  entityType: string | null; entityId: string | null; title: string; summary: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low'; confidence: number | null; recommendedAction: string | null;
  status: CommandCenterStatus; firstDetectedAt: string; lastSeenAt: string; snoozedUntil: string | null;
  reviewedAt: string | null; assignedAt: string | null; assignedToProfileId: string | null; assignedToEmail: string | null;
  occurrenceCount: number; lastOccurrenceDate: string | null; reopenCount: number;
  relatedExistingExceptionId: string | null; lastRunId: string | null; businessDate: string | null;
};

export type CommandCenterFindingPage = { total: number; limit: number; offset: number; items: CommandCenterFinding[] };

export type CommandCenterModuleStatus = { module: string; status: string; completedAt: string | null; errorSummary: string | null };

export type CommandCenterOverview = {
  businessDate: string | null;
  run: { id: string; businessDate: string; startedAt: string | null; completedAt: string | null; overallStatus: string; publicationStatus: string } | null;
  modules: CommandCenterModuleStatus[];
  counts: {
    open: number; critical: number; high: number; medium: number; low: number; snoozed: number;
    newSinceYesterday: number; resolvedSinceYesterday: number; recurring: number;
  };
  byCategory: Record<string, { open: number; critical: number; high: number }>;
  brief: {
    id: string; businessDate: string; isPartial: boolean; status: string;
    sections: Array<{ key?: string; heading?: string; body?: string; severity?: string; itemCount?: number }>;
    everythingNormal: string[]; generatedAt: string | null; model: string | null;
  } | null;
  weeklyReview: { id: string; weekEnding: string; result: { weekSummary?: string; patterns?: Array<Record<string, unknown>>; gaps?: string[] }; createdAt: string } | null;
};

export type CommandCenterChangeItem = {
  id: string; title: string; severity: string; category: CommandCenterCategory; module: string;
  detectedAt?: string; changedAt?: string; closedAt?: string; previousSeverity?: string; status?: string;
  occurrenceCount?: number; reopenCount?: number; firstDetectedAt?: string; lastSeenAt?: string;
};

export type CommandCenterChanges = {
  businessDate: string; since: string;
  new: CommandCenterChangeItem[]; worsened: CommandCenterChangeItem[];
  resolved: CommandCenterChangeItem[]; recurring: CommandCenterChangeItem[];
};

export type CommandCenterAssignee = { profileId: string; email: string | null; crmRole: string };

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchCommandCenterOverview = (businessDate?: string | null) =>
  rpc<CommandCenterOverview>('command_center_overview', { p_business_date: businessDate ?? null });

export const fetchCommandCenterChanges = (businessDate?: string | null, limit = 25) =>
  rpc<CommandCenterChanges>('command_center_changes', { p_business_date: businessDate ?? null, p_limit: limit });

export const fetchCommandCenterAssignees = () => rpc<CommandCenterAssignee[]>('command_center_assignable_users');

export type CommandCenterFindingQuery = {
  view?: CommandCenterView; category?: CommandCenterCategory | null; severity?: string | null;
  status?: string | null; module?: string | null; assignedTo?: string | null; since?: string | null;
  limit?: number; offset?: number;
};

export const fetchCommandCenterFindings = (query: CommandCenterFindingQuery = {}) =>
  rpc<CommandCenterFindingPage>('command_center_findings', {
    p_view: query.view ?? 'active',
    p_category: query.category ?? null,
    p_severity: query.severity ?? null,
    p_status: query.status ?? null,
    p_module: query.module ?? null,
    p_assigned_to: query.assignedTo ?? null,
    p_since: query.since ?? null,
    p_limit: query.limit ?? 100,
    p_offset: query.offset ?? 0,
  });

export const reviewFinding = (findingId: string, reason: string) =>
  rpc('ai_operations_review_finding', { p_finding_id: findingId, p_reason: reason });
export const assignFinding = (findingId: string, assignee: string, reason: string) =>
  rpc('ai_operations_assign_finding', { p_finding_id: findingId, p_assignee: assignee, p_reason: reason });
export const startFinding = (findingId: string, reason: string) =>
  rpc('ai_operations_start_finding', { p_finding_id: findingId, p_reason: reason });

/** Deterministic priority ordering. Severity is authoritative; AI never reorders it. */
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;
export function severityRank(severity: string): number {
  const index = SEVERITY_ORDER.indexOf(severity as (typeof SEVERITY_ORDER)[number]);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

/** Critical → High → Medium → Low, then most recently seen/changed first. */
export function sortFindingsForTriage<T extends { severity: string; lastSeenAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
  });
}

/** Modules whose most recent cycle did not succeed — used for graceful-degradation notices. */
export function incompleteModules(overview: CommandCenterOverview | null | undefined): CommandCenterModuleStatus[] {
  return (overview?.modules ?? []).filter((entry) => entry.status !== 'success');
}

export function isFindingRecurring(finding: Pick<CommandCenterFinding, 'occurrenceCount' | 'reopenCount'>): boolean {
  return (finding.occurrenceCount ?? 1) >= 3 || (finding.reopenCount ?? 0) >= 1;
}

/**
 * Deterministic source routing. Every entity type a finding can carry must resolve to the
 * operational page where the work happens; AI Operations entities (operations registry,
 * smoke flows, runs) fall back to the AI Operations console.
 */
export type CommandCenterSourceLink = { path: string; label: string };

export function sourceLinkFor(entityType: string | null | undefined, entityId: string | null | undefined): CommandCenterSourceLink | null {
  if (!entityType) return null;
  switch (entityType) {
    case 'client': return entityId ? { path: `/crm/clients/${entityId}`, label: 'Open client' } : null;
    case 'staff': return { path: '/crm/staff', label: 'Open staff' };
    case 'task': return { path: '/crm/tasks', label: 'Open tasks' };
    case 'claim':
    case 'appointment': return { path: '/crm/exceptions', label: 'Open exceptions' };
    case 'conversation': return { path: '/crm/inbox', label: 'Open inbox' };
    case 'relationship_organization':
      return entityId ? { path: `/crm/business-development/organizations/${entityId}`, label: 'Open organization' } : null;
    case 'relationship_contact':
      return entityId ? { path: `/crm/business-development/contacts/${entityId}`, label: 'Open contact' } : null;
    case 'relationship_opportunity':
      return entityId ? { path: `/crm/business-development/opportunities/${entityId}`, label: 'Open opportunity' } : null;
    case 'operation': return { path: '/crm/ai-operations', label: 'Open AI Operations' };
    case 'smoke_flow': return { path: '/crm/ai-operations', label: 'Open smoke tests' };
    case 'run':
    case 'module_run':
    case 'ai_operation': return { path: '/crm/ai-operations', label: 'Open AI Operations' };
    default: return null;
  }
}

/** Run publication vocabulary written by the brief publication step. */
export const RUN_PUBLICATION_LABELS: Record<string, string> = {
  unpublished: 'Not published',
  published: 'Published',
  published_partial: 'Published (partial)',
};

export function isRunPublished(publicationStatus: string | null | undefined): boolean {
  return publicationStatus === 'published' || publicationStatus === 'published_partial';
}

