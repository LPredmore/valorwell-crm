import { supabase } from '@/integrations/supabase/client';
import type { ReportsRepository } from '../types';
import {
  LIFECYCLE_STAGES, ENGAGEMENT_STATES,
  mapDbLifecycleToDomain, mapDbEngagementToDomain, mapDbClosureReasonToDomain,
  type LifecycleStage, type EngagementState,
} from '@/domain/canonical';
import type { Tables } from '@/integrations/supabase/types';

type JourneyClientRow = Pick<
  Tables<'clients'>,
  'lifecycle_stage' | 'lifecycle_stage_changed_at' | 'created_at'
>;
type AtRiskClientRow = Pick<
  Tables<'clients'>,
  'id' | 'at_risk' | 'at_risk_since' | 'lifecycle_stage'
>;
type EngagementClientRow = Pick<Tables<'clients'>, 'engagement_state' | 'last_contact_at'>;
type ClosureClientRow = Pick<Tables<'clients'>, 'closure_reason'>;
type CanonicalMetaRow = Pick<
  Tables<'crm_client_canonical_meta'>,
  'client_id' | 'risk_reason' | 'at_risk_marked_at'
>;
type CampaignRow = Pick<Tables<'crm_campaigns'>, 'id' | 'name'>;
type CampaignEnrollmentRow = Pick<Tables<'crm_campaign_enrollments'>, 'campaign_id' | 'status'>;
type CampaignStepLogRow = Pick<
  Tables<'crm_campaign_step_logs'>,
  'step_id' | 'status' | 'enrollment_id'
>;
type CampaignStepRow = Pick<Tables<'crm_campaign_steps'>, 'id' | 'campaign_id'>;
type TaskPerformanceRow = Pick<
  Tables<'crm_tasks'>,
  'owner_id' | 'status' | 'due_at' | 'completed_at' | 'created_at'
>;
type ExceptionMetricRow = Pick<
  Tables<'crm_exceptions'>,
  'type' | 'severity' | 'status' | 'created_at' | 'updated_at'
>;

interface PageResult<Row> {
  data: Row[] | null;
  error: { message: string } | null;
}

type PageFetcher<Row> = (from: number, to: number) => PromiseLike<PageResult<Row>>;

async function fetchAll<Row>(fetchPage: PageFetcher<Row>): Promise<Row[]> {
  // Paged fetch because Supabase caps at 1000/row.
  const all: Row[] = [];
  const size = 1000;
  let from = 0;
  // Safety upper bound to avoid runaway loops.
  for (let i = 0; i < 20; i += 1) {
    const { data, error } = await fetchPage(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < size) break;
    from += size;
  }
  return all;
}

function medianLifecycleDays(rows: JourneyClientRow[]): number {
  const spans: number[] = [];
  for (const r of rows) {
    const days = (
      new Date(r.lifecycle_stage_changed_at).getTime() - new Date(r.created_at).getTime()
    ) / 86_400_000;
    if (Number.isFinite(days) && days >= 0) spans.push(days);
  }
  if (!spans.length) return 0;
  spans.sort((x, y) => x - y);
  const mid = Math.floor(spans.length / 2);
  return spans.length % 2 ? Math.round(spans[mid]) : Math.round((spans[mid - 1] + spans[mid]) / 2);
}

export const supabaseReportsRepository: ReportsRepository = {
  async journeyFunnel() {
    const clients = await fetchAll<JourneyClientRow>((from, to) => supabase
      .from('clients')
      .select('lifecycle_stage, lifecycle_stage_changed_at, created_at')
      .range(from, to));
    const stageRows: Record<LifecycleStage, JourneyClientRow[]> = {
      Registration: [],
      Intake: [],
      Matching: [],
      Matched: [],
      Scheduled: [],
      'Early Care': [],
      'Established Care': [],
      Closed: [],
    };
    for (const c of clients) {
      try {
        const s = mapDbLifecycleToDomain(c.lifecycle_stage);
        stageRows[s].push(c);
      } catch { /* unknown stage */ }
    }
    return LIFECYCLE_STAGES.map((stage) => ({
      stage,
      count: stageRows[stage].length,
      medianDays: medianLifecycleDays(stageRows[stage]),
    }));
  },

  async atRiskMetrics() {
    const clients = await fetchAll<AtRiskClientRow>((from, to) => supabase
      .from('clients')
      .select('id, at_risk, at_risk_since, lifecycle_stage')
      .range(from, to));
    const atRisk = clients.filter((c) => c.at_risk === true);
    const now = Date.now();
    const THIRTY_D = 30 * 86_400_000;
    const newly = atRisk.filter((c) => c.at_risk_since && (now - new Date(c.at_risk_since).getTime()) <= 7 * 86_400_000).length;
    const spans = atRisk
      .map((c) => c.at_risk_since ? (now - new Date(c.at_risk_since).getTime()) / 86_400_000 : null)
      .filter((v): v is number => v != null);
    const avg = spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : 0;

    const byStageMap = new Map<LifecycleStage, number>();
    for (const c of atRisk) {
      try {
        const s = mapDbLifecycleToDomain(c.lifecycle_stage);
        byStageMap.set(s, (byStageMap.get(s) ?? 0) + 1);
      } catch { /* skip */ }
    }

    // Reasons live on crm_client_canonical_meta.risk_reason
    const meta = await fetchAll<CanonicalMetaRow>((from, to) => supabase
      .from('crm_client_canonical_meta')
      .select('client_id, risk_reason, at_risk_marked_at')
      .range(from, to));
    const reasonCounts = new Map<string, number>();
    const atRiskIds = new Set(atRisk.map((c) => c.id));
    for (const m of meta) {
      if (!m.risk_reason) continue;
      if (!atRiskIds.has(m.client_id)) continue;
      reasonCounts.set(m.risk_reason, (reasonCounts.get(m.risk_reason) ?? 0) + 1);
    }

    // Overdue interventions = open crm_tasks with type=risk_intervention past due
    const nowIso = new Date().toISOString();
    const { count: overdue, error: taskErr } = await supabase
      .from('crm_tasks')
      .select('id', { head: true, count: 'exact' })
      .eq('type', 'risk_intervention')
      .lt('due_at', nowIso)
      .not('status', 'in', '(completed,canceled)');
    if (taskErr) throw new Error(taskErr.message);

    return {
      totalAtRisk: atRisk.length,
      newlyAtRisk: newly,
      resolved: Math.max(0, meta.length - atRisk.length),
      averageDaysAtRisk: avg,
      byReason: Array.from(reasonCounts.entries()).map(([reason, count]) => ({ reason, count })),
      byStage: Array.from(byStageMap.entries()).map(([stage, count]) => ({ stage, count })),
      overdueInterventions: overdue ?? 0,
    };
  },

  async engagementMetrics() {
    const clients = await fetchAll<EngagementClientRow>((from, to) => supabase
      .from('clients')
      .select('engagement_state, last_contact_at')
      .range(from, to));
    const counts: Record<EngagementState, number> = { Engaged: 0, Warm: 0, Cold: 0, 'Went Dark': 0 };
    for (const c of clients) {
      try {
        const s = mapDbEngagementToDomain(c.engagement_state);
        counts[s] += 1;
      } catch { /* skip */ }
    }
    const now = Date.now();
    const days = clients
      .map((c) => c.last_contact_at ? (now - new Date(c.last_contact_at).getTime()) / 86_400_000 : null)
      .filter((v): v is number => v != null && Number.isFinite(v));
    days.sort((a, b) => a - b);
    const median = days.length
      ? (days.length % 2 ? days[Math.floor(days.length / 2)] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2)
      : 0;
    const engaged = counts.Engaged;
    const total = clients.length || 1;
    return { counts, reengagementRate: Math.round((engaged / total) * 100) / 100, medianDaysSinceLastContact: Math.round(median) };
  },

  async closureMetrics() {
    const clients = await fetchAll<ClosureClientRow>((from, to) => supabase
      .from('clients')
      .select('closure_reason')
      .range(from, to));
    const map = new Map<string, number>();
    for (const c of clients) {
      if (!c.closure_reason) continue;
      let label: string = c.closure_reason;
      try { label = mapDbClosureReasonToDomain(c.closure_reason); } catch { /* raw */ }
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  },

  async campaignPerformance() {
    const [campaigns, enrollments, logs] = await Promise.all([
      fetchAll<CampaignRow>((from, to) => supabase
        .from('crm_campaigns')
        .select('id, name')
        .range(from, to)),
      fetchAll<CampaignEnrollmentRow>((from, to) => supabase
        .from('crm_campaign_enrollments')
        .select('campaign_id, status')
        .range(from, to)),
      fetchAll<CampaignStepLogRow>((from, to) => supabase
        .from('crm_campaign_step_logs')
        .select('step_id, status, enrollment_id')
        .range(from, to)),
    ]);
    // Map step -> campaign via a step lookup.
    const steps = await fetchAll<CampaignStepRow>((from, to) => supabase
      .from('crm_campaign_steps')
      .select('id, campaign_id')
      .range(from, to));
    const campaignByStep = new Map<string, string>(steps.map((s) => [s.id, s.campaign_id]));

    const acc = new Map<string, { enrolled: number; completed: number; suppressed: number; failed: number; canceled: number; sent: number; delivered: number; responded: number }>();
    for (const c of campaigns) {
      acc.set(c.id, { enrolled: 0, completed: 0, suppressed: 0, failed: 0, canceled: 0, sent: 0, delivered: 0, responded: 0 });
    }
    for (const e of enrollments) {
      const rec = acc.get(e.campaign_id); if (!rec) continue;
      rec.enrolled += 1;
      if (e.status === 'completed') rec.completed += 1;
      if (e.status === 'failed') rec.failed += 1;
      if (e.status === 'canceled' || e.status === 'cancelled') rec.canceled += 1;
    }
    for (const l of logs) {
      const cid = campaignByStep.get(l.step_id); if (!cid) continue;
      const rec = acc.get(cid); if (!rec) continue;
      if (l.status === 'sent' || l.status === 'delivered') rec.sent += 1;
      if (l.status === 'delivered') rec.delivered += 1;
      if (l.status === 'suppressed' || l.status === 'skipped') rec.suppressed += 1;
      if (l.status === 'failed') rec.failed += 1;
    }
    return campaigns.map((c) => {
      const r = acc.get(c.id)!;
      return {
        campaignId: c.id, name: c.name,
        enrolled: r.enrolled, sent: r.sent, delivered: r.delivered,
        responded: r.responded, completed: r.completed,
        suppressed: r.suppressed, failed: r.failed, optedOut: r.canceled,
      };
    });
  },

  async taskPerformance() {
    const tasks = await fetchAll<TaskPerformanceRow>((from, to) => supabase
      .from('crm_tasks')
      .select('owner_id, status, due_at, completed_at, created_at')
      .range(from, to));
    const now = Date.now();
    const isOpen = (s: string) => s !== 'completed' && s !== 'canceled';
    let open = 0, overdue = 0;
    const byOwner = new Map<string, { open: number; overdue: number }>();
    const completions: number[] = [];
    for (const t of tasks) {
      if (isOpen(t.status)) open += 1;
      const isOverdue = t.due_at !== null
        && new Date(t.due_at).getTime() < now
        && t.status !== 'completed';
      if (isOverdue) overdue += 1;
      if (t.status === 'completed' && t.completed_at && t.created_at) {
        completions.push((new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / 3_600_000);
      }
      if (t.owner_id) {
        const rec = byOwner.get(t.owner_id) ?? { open: 0, overdue: 0 };
        if (isOpen(t.status)) rec.open += 1;
        if (isOverdue) rec.overdue += 1;
        byOwner.set(t.owner_id, rec);
      }
    }
    const avg = completions.length
      ? Math.round(completions.reduce((a, b) => a + b, 0) / completions.length)
      : 0;
    return {
      open, overdue, avgCompletionHours: avg,
      byOwner: Array.from(byOwner.entries()).map(([ownerId, v]) => ({ ownerId, ...v })),
    };
  },

  async exceptionMetrics() {
    const rows = await fetchAll<ExceptionMetricRow>((from, to) => supabase
      .from('crm_exceptions')
      .select('type, severity, status, created_at, updated_at')
      .range(from, to));
    const byType = new Map<string, number>();
    const bySev = new Map<string, number>();
    let open = 0, resolved = 0;
    const resolutions: number[] = [];
    for (const e of rows) {
      byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
      bySev.set(e.severity, (bySev.get(e.severity) ?? 0) + 1);
      if (e.status === 'open' || e.status === 'in_review') open += 1;
      if (e.status === 'resolved') {
        resolved += 1;
        if (e.created_at && e.updated_at) {
          resolutions.push((new Date(e.updated_at).getTime() - new Date(e.created_at).getTime()) / 3_600_000);
        }
      }
    }
    const avg = resolutions.length
      ? Math.round(resolutions.reduce((a, b) => a + b, 0) / resolutions.length)
      : 0;
    return {
      byType: Array.from(byType.entries()).map(([type, count]) => ({ type, count })),
      bySeverity: Array.from(bySev.entries()).map(([severity, count]) => ({ severity, count })),
      openVsResolved: { open, resolved },
      avgResolutionHours: avg,
    };
  },
};
