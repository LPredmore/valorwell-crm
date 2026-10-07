import { buildStaffOperatorDisplayName } from '@/domain/staffIdentity';
import {
  mapDbClosureReasonToDomain,
  mapDbEngagementToDomain,
  mapDbLifecycleToDomain,
} from '@/domain/canonical';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import {
  ReportQueryError,
  toReportQueryError,
  type ReportName,
  type ReportViewName,
} from '@/repositories/reportErrors';
import type {
  CampaignReportRow,
  ClosureReportRow,
  EngagementReportRow,
  ExceptionReportRow,
  FunnelReportRow,
  ReportBucket,
  ReportsRepository,
  TaskReportRow,
} from '../types';

type FunnelViewRow = Tables<'v_crm_reports_funnel'>;
type EngagementViewRow = Tables<'v_crm_reports_engagement'>;
type ClosureViewRow = Tables<'v_crm_reports_closure'>;
type CampaignViewRow = Tables<'v_crm_reports_campaigns'>;
type TaskViewRow = Tables<'v_crm_reports_tasks'>;
type ExceptionViewRow = Tables<'v_crm_reports_exceptions'>;

interface BucketedViewRow {
  bucket_start: string | null;
  bucket_end: string | null;
}

interface LatestViewBucket<Row> {
  bucketStart: string;
  bucketEnd: string | null;
  rows: Row[];
}

interface ReportQueryResult<Row> {
  data: Row[] | null;
  error: { code?: string; message: string } | null;
}

interface LatestBucketQueryResult {
  data: { bucket_start: string | null } | null;
  error: { code?: string; message: string } | null;
}

type BucketPageFetcher<Row> = (
  bucketStart: string,
  from: number,
  to: number,
) => PromiseLike<ReportQueryResult<Row>>;

const REPORT_PAGE_SIZE = 1_000;
const MAX_REPORT_PAGES = 100;

function uniqueNonNull(values: readonly (string | null)[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

async function loadCampaignNames(
  tenantId: string,
  rows: readonly CampaignViewRow[],
): Promise<Map<string, string>> {
  const campaignIds = uniqueNonNull(rows.map((row) => row.campaign_id));
  if (campaignIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('crm_campaigns')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .in('id', campaignIds);
  if (error) throw toReportQueryError('campaigns', 'v_crm_reports_campaigns', error);

  return new Map((data ?? []).map((campaign) => [campaign.id, campaign.name]));
}

async function loadAssigneeNames(
  tenantId: string,
  rows: readonly TaskViewRow[],
): Promise<Map<string, string>> {
  const assigneeIds = uniqueNonNull(rows.map((row) => row.assignee_id));
  if (assigneeIds.length === 0) return new Map();

  const { data: staffRows, error: staffError } = await supabase
    .from('staff')
    .select('profile_id, prov_name_for_clients, prov_name_f, prov_name_l')
    .eq('tenant_id', tenantId)
    .in('profile_id', assigneeIds);
  if (staffError) throw toReportQueryError('tasks', 'v_crm_reports_tasks', staffError);

  const staffProfileIds = uniqueNonNull((staffRows ?? []).map((row) => row.profile_id));
  let emailByProfile = new Map<string, string>();
  if (staffProfileIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', staffProfileIds);
    if (profileError) throw toReportQueryError('tasks', 'v_crm_reports_tasks', profileError);
    emailByProfile = new Map((profiles ?? []).map((profile) => [profile.id, profile.email]));
  }

  const names = new Map<string, string>();
  for (const staff of staffRows ?? []) {
    if (!staff.profile_id) continue;
    names.set(staff.profile_id, buildStaffOperatorDisplayName({
      preferredDisplayName: staff.prov_name_for_clients,
      firstName: staff.prov_name_f,
      lastName: staff.prov_name_l,
      email: emailByProfile.get(staff.profile_id),
    }));
  }
  return names;
}

function safeNumber(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function validateReportDimension(
  report: ReportName,
  view: ReportViewName,
  dimension: string,
  value: string | null,
  validate: (candidate: string) => unknown,
): void {
  if (value === null) return;

  try {
    validate(value);
  } catch {
    throw new ReportQueryError(
      report,
      view,
      'query-failed',
      `${view} returned unsupported ${dimension} value: ${value}`,
    );
  }
}

export function selectLatestBucket<Row extends BucketedViewRow>(
  rows: readonly Row[],
): LatestViewBucket<Row> | null {
  let latestStart: string | null = null;
  for (const row of rows) {
    if (row.bucket_start !== null && (latestStart === null || row.bucket_start > latestStart)) {
      latestStart = row.bucket_start;
    }
  }
  if (latestStart === null) return null;

  const latestRows = rows.filter((row) => row.bucket_start === latestStart);
  let latestEnd: string | null = null;
  for (const row of latestRows) {
    if (row.bucket_end !== null && (latestEnd === null || row.bucket_end > latestEnd)) {
      latestEnd = row.bucket_end;
    }
  }

  return { bucketStart: latestStart, bucketEnd: latestEnd, rows: latestRows };
}

async function readLatestReportRows<Row>(
  report: ReportName,
  view: ReportViewName,
  latestBucketQuery: PromiseLike<LatestBucketQueryResult>,
  fetchPage: BucketPageFetcher<Row>,
): Promise<Row[]> {
  const { data: latest, error: latestError } = await latestBucketQuery;
  if (latestError) throw toReportQueryError(report, view, latestError);
  if (!latest?.bucket_start) return [];

  const rows: Row[] = [];
  for (let page = 0; page < MAX_REPORT_PAGES; page += 1) {
    const from = page * REPORT_PAGE_SIZE;
    const { data, error } = await fetchPage(
      latest.bucket_start,
      from,
      from + REPORT_PAGE_SIZE - 1,
    );
    if (error) throw toReportQueryError(report, view, error);
    const pageRows = data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < REPORT_PAGE_SIZE) return rows;
  }

  throw new ReportQueryError(
    report,
    view,
    'query-failed',
    `${view} exceeded the ${MAX_REPORT_PAGES * REPORT_PAGE_SIZE} row safety limit for one weekly bucket`,
  );
}

function mapLatestBucket<ViewRow extends BucketedViewRow, DomainRow>(
  tenantId: string,
  rows: readonly ViewRow[],
  mapRow: (row: ViewRow) => DomainRow,
  sortKey: (row: DomainRow) => string,
): ReportBucket<DomainRow> | null {
  const latest = selectLatestBucket(rows);
  if (!latest) return null;
  return {
    tenantId,
    bucketStart: latest.bucketStart,
    bucketEnd: latest.bucketEnd,
    rows: latest.rows
      .map(mapRow)
      .sort((left, right) => sortKey(left).localeCompare(sortKey(right))),
  };
}

export const supabaseReportsRepository: ReportsRepository = {
  async journeyFunnel(tenantId) {
    const rows = await readLatestReportRows<FunnelViewRow>(
      'funnel',
      'v_crm_reports_funnel',
      supabase
        .from('v_crm_reports_funnel')
        .select('bucket_start')
        .eq('tenant_id', tenantId)
        .not('bucket_start', 'is', null)
        .order('bucket_start', { ascending: false })
        .limit(1)
        .maybeSingle(),
      (bucketStart, from, to) => supabase
        .from('v_crm_reports_funnel')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('bucket_start', bucketStart)
        .order('stage', { ascending: true, nullsFirst: true })
        .range(from, to),
    );
    return mapLatestBucket<FunnelViewRow, FunnelReportRow>(
      tenantId,
      rows,
      (row) => {
        validateReportDimension(
          'funnel',
          'v_crm_reports_funnel',
          'lifecycle stage',
          row.stage,
          mapDbLifecycleToDomain,
        );
        return {
          ...row,
          entered_count: safeNumber(row.entered_count),
          exited_count: safeNumber(row.exited_count),
          current_count: safeNumber(row.current_count),
          median_days_in_stage: safeNumber(row.median_days_in_stage),
        };
      },
      (row) => row.stage ?? '',
    );
  },

  async engagementMetrics(tenantId) {
    const rows = await readLatestReportRows<EngagementViewRow>(
      'engagement',
      'v_crm_reports_engagement',
      supabase
        .from('v_crm_reports_engagement')
        .select('bucket_start')
        .eq('tenant_id', tenantId)
        .not('bucket_start', 'is', null)
        .order('bucket_start', { ascending: false })
        .limit(1)
        .maybeSingle(),
      (bucketStart, from, to) => supabase
        .from('v_crm_reports_engagement')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('bucket_start', bucketStart)
        .order('engagement', { ascending: true, nullsFirst: true })
        .range(from, to),
    );
    return mapLatestBucket<EngagementViewRow, EngagementReportRow>(
      tenantId,
      rows,
      (row) => {
        validateReportDimension(
          'engagement',
          'v_crm_reports_engagement',
          'engagement state',
          row.engagement,
          mapDbEngagementToDomain,
        );
        return {
          ...row,
          current_count: safeNumber(row.current_count),
          entered_count: safeNumber(row.entered_count),
        };
      },
      (row) => row.engagement ?? '',
    );
  },

  async closureMetrics(tenantId) {
    const rows = await readLatestReportRows<ClosureViewRow>(
      'closure',
      'v_crm_reports_closure',
      supabase
        .from('v_crm_reports_closure')
        .select('bucket_start')
        .eq('tenant_id', tenantId)
        .not('bucket_start', 'is', null)
        .order('bucket_start', { ascending: false })
        .limit(1)
        .maybeSingle(),
      (bucketStart, from, to) => supabase
        .from('v_crm_reports_closure')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('bucket_start', bucketStart)
        .order('disposition_reason', { ascending: true, nullsFirst: true })
        .range(from, to),
    );
    return mapLatestBucket<ClosureViewRow, ClosureReportRow>(
      tenantId,
      rows,
      (row) => {
        validateReportDimension(
          'closure',
          'v_crm_reports_closure',
          'closure disposition',
          row.disposition_reason === 'unspecified' ? null : row.disposition_reason,
          mapDbClosureReasonToDomain,
        );
        return {
          ...row,
          closed_count: safeNumber(row.closed_count),
          reopened_count: safeNumber(row.reopened_count),
          net_closed: safeNumber(row.net_closed),
        };
      },
      (row) => row.disposition_reason ?? '',
    );
  },

  async campaignPerformance(tenantId) {
    const rows = await readLatestReportRows<CampaignViewRow>(
      'campaigns',
      'v_crm_reports_campaigns',
      supabase
        .from('v_crm_reports_campaigns')
        .select('bucket_start')
        .eq('tenant_id', tenantId)
        .not('bucket_start', 'is', null)
        .order('bucket_start', { ascending: false })
        .limit(1)
        .maybeSingle(),
      (bucketStart, from, to) => supabase
        .from('v_crm_reports_campaigns')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('bucket_start', bucketStart)
        .order('campaign_id', { ascending: true, nullsFirst: true })
        .range(from, to),
    );
    const campaignNames = await loadCampaignNames(tenantId, rows);
    return mapLatestBucket<CampaignViewRow, CampaignReportRow>(
      tenantId,
      rows,
      (row) => ({
        ...row,
        campaignName: row.campaign_id
          ? (campaignNames.get(row.campaign_id) ?? 'Unknown campaign')
          : 'Unknown campaign',
        enrolled_count: safeNumber(row.enrolled_count),
        completed_count: safeNumber(row.completed_count),
        cancelled_count: safeNumber(row.cancelled_count),
        responded_count: safeNumber(row.responded_count),
        suppressed_count: safeNumber(row.suppressed_count),
        failed_count: safeNumber(row.failed_count),
      }),
      (row) => row.campaignName,
    );
  },

  async taskPerformance(tenantId) {
    const rows = await readLatestReportRows<TaskViewRow>(
      'tasks',
      'v_crm_reports_tasks',
      supabase
        .from('v_crm_reports_tasks')
        .select('bucket_start')
        .eq('tenant_id', tenantId)
        .not('bucket_start', 'is', null)
        .order('bucket_start', { ascending: false })
        .limit(1)
        .maybeSingle(),
      (bucketStart, from, to) => supabase
        .from('v_crm_reports_tasks')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('bucket_start', bucketStart)
        .order('assignee_id', { ascending: true, nullsFirst: true })
        .range(from, to),
    );
    const assigneeNames = await loadAssigneeNames(tenantId, rows);
    return mapLatestBucket<TaskViewRow, TaskReportRow>(
      tenantId,
      rows,
      (row) => ({
        ...row,
        assigneeName: row.assignee_id
          ? (assigneeNames.get(row.assignee_id) ?? 'Unknown staff member')
          : 'Unassigned',
        open_count: safeNumber(row.open_count),
        completed_count: safeNumber(row.completed_count),
        overdue_count: safeNumber(row.overdue_count),
        median_hours_to_complete: safeNumber(row.median_hours_to_complete),
      }),
      (row) => row.assigneeName,
    );
  },

  async exceptionMetrics(tenantId) {
    const rows = await readLatestReportRows<ExceptionViewRow>(
      'exceptions',
      'v_crm_reports_exceptions',
      supabase
        .from('v_crm_reports_exceptions')
        .select('bucket_start')
        .eq('tenant_id', tenantId)
        .not('bucket_start', 'is', null)
        .order('bucket_start', { ascending: false })
        .limit(1)
        .maybeSingle(),
      (bucketStart, from, to) => supabase
        .from('v_crm_reports_exceptions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('bucket_start', bucketStart)
        .order('exception_type', { ascending: true, nullsFirst: true })
        .range(from, to),
    );
    return mapLatestBucket<ExceptionViewRow, ExceptionReportRow>(
      tenantId,
      rows,
      (row) => ({
        ...row,
        raised_count: safeNumber(row.raised_count),
        resolved_count: safeNumber(row.resolved_count),
        open_count: safeNumber(row.open_count),
        median_hours_to_resolve: safeNumber(row.median_hours_to_resolve),
      }),
      (row) => row.exception_type ?? '',
    );
  },
};
