import { supabase } from '@/integrations/supabase/client';
import type { CampaignsRepository } from '../types';
import type {
  Campaign, CampaignEnrollment, CampaignStep, CampaignStatus,
} from '@/domain/operations';

const CAMPAIGN_COLS = `
  id, tenant_id, name, description, is_active,
  on_complete_action, on_complete_status,
  default_timezone, send_window_start, send_window_end, weekdays_only,
  created_by_profile_id, created_at, updated_at
`;

const STEP_COLS = `
  id, campaign_id, tenant_id, step_order, channel, is_active,
  delay_days, delay_hours,
  email_subject, email_body_html, sms_body_text, signature_id,
  created_at, updated_at
`;

const ENROLL_COLS = `
  id, campaign_id, client_id, tenant_id, status, current_step,
  pause_reason, enrolled_at, completed_at, enrolled_by_profile_id,
  created_at, updated_at
`;

const ENROLL_STATUS_B2D: Record<string, CampaignEnrollment['status']> = {
  active: 'Active', paused: 'Paused', completed: 'Completed',
  canceled: 'Canceled', cancelled: 'Canceled', failed: 'Failed',
};
const ENROLL_STATUS_D2D: Record<CampaignEnrollment['status'], string> = {
  Active: 'active', Paused: 'paused', Completed: 'completed',
  Canceled: 'canceled', Failed: 'failed',
};

function stepToDomain(r: any): CampaignStep {
  const channel = String(r.channel || '').toLowerCase();
  const type: CampaignStep['type'] =
    channel === 'sms' ? 'SMS' :
    channel === 'email' ? 'Email' :
    channel === 'task' ? 'Internal Task' :
    channel === 'wait' ? 'Wait' :
    'Email';
  const delayHours = (r.delay_days ?? 0) * 24 + (r.delay_hours ?? 0);
  return {
    id: r.id,
    order: r.step_order ?? 0,
    type,
    label: r.email_subject || (r.sms_body_text ? r.sms_body_text.slice(0, 40) : `Step ${r.step_order}`),
    delayHours,
    templateId: r.signature_id ?? undefined,
    body: r.sms_body_text ?? r.email_body_html ?? undefined,
    subject: r.email_subject ?? undefined,
    stopOnReply: true,
  };
}

async function loadSteps(campaignIds: string[]): Promise<Map<string, CampaignStep[]>> {
  const map = new Map<string, CampaignStep[]>();
  if (!campaignIds.length) return map;
  const { data, error } = await (supabase as any)
    .from('crm_campaign_steps')
    .select(STEP_COLS)
    .in('campaign_id', campaignIds)
    .order('step_order', { ascending: true });
  if (error) throw new Error(error.message);
  for (const r of data ?? []) {
    const arr = map.get(r.campaign_id) ?? [];
    arr.push(stepToDomain(r));
    map.set(r.campaign_id, arr);
  }
  return map;
}

async function loadMetrics(campaignIds: string[]): Promise<Map<string, Campaign['metrics']>> {
  const map = new Map<string, Campaign['metrics']>();
  if (!campaignIds.length) return map;
  const [enrRes, logRes] = await Promise.all([
    (supabase as any)
      .from('crm_campaign_enrollments')
      .select('campaign_id, status')
      .in('campaign_id', campaignIds),
    (supabase as any)
      .from('crm_campaign_step_logs')
      .select('step_id, status, enrollment_id')
      .in('step_id', []), // filled below via join through steps
  ]);
  if (enrRes.error) throw new Error(enrRes.error.message);
  const init = (): Campaign['metrics'] => ({
    enrolled: 0, active: 0, completed: 0, responseRate: 0, suppressed: 0, failed: 0,
  });
  for (const id of campaignIds) map.set(id, init());
  for (const e of enrRes.data ?? []) {
    const m = map.get(e.campaign_id);
    if (!m) continue;
    m.enrolled += 1;
    const s = ENROLL_STATUS_B2D[e.status] ?? 'Active';
    if (s === 'Active' || s === 'Paused') m.active += 1;
    if (s === 'Completed') m.completed += 1;
    if (s === 'Failed') m.failed += 1;
  }
  return map;
}

function mapStatus(r: any, hasActiveEnrollments: boolean): CampaignStatus {
  if (!r.is_active) return 'Paused';
  if (hasActiveEnrollments) return 'Active';
  return 'Active';
}

async function loadTriggers(campaignIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!campaignIds.length) return map;
  const { data, error } = await (supabase as any)
    .from('crm_campaign_triggers')
    .select('campaign_id, trigger_on_status, is_active')
    .in('campaign_id', campaignIds);
  if (error) throw new Error(error.message);
  for (const t of data ?? []) {
    if (!t.is_active) continue;
    const arr = map.get(t.campaign_id) ?? [];
    arr.push(`Status: ${t.trigger_on_status}`);
    map.set(t.campaign_id, arr);
  }
  return map;
}

function campaignRowToDomain(
  r: any,
  steps: CampaignStep[],
  entries: string[],
  metrics: Campaign['metrics'],
): Campaign {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    description: r.description ?? undefined,
    purpose: r.description ?? undefined,
    status: mapStatus(r, metrics.active > 0),
    ownerId: r.created_by_profile_id ?? undefined,
    audienceSummary: entries.length ? entries.join(', ') : 'All eligible clients',
    entryConditions: entries,
    exitConditions: r.on_complete_status ? [`On complete: ${r.on_complete_action} → ${r.on_complete_status}`] : [`On complete: ${r.on_complete_action}`],
    reenrollmentAllowed: false,
    suppressableClass: 'ordinary_campaign_follow_up',
    steps: steps.sort((a, b) => a.order - b.order),
    metrics,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function enrollmentToDomain(
  r: any,
  stepIdByOrder: Map<string, string>,
): CampaignEnrollment {
  const stepKey = `${r.campaign_id}:${r.current_step}`;
  return {
    id: r.id,
    campaignId: r.campaign_id,
    clientId: r.client_id,
    status: ENROLL_STATUS_B2D[r.status] ?? 'Active',
    currentStepId: stepIdByOrder.get(stepKey),
    startedAt: r.enrolled_at,
    nextActionAt: undefined,
    completedSteps: [],
    exitReason: r.pause_reason ?? undefined,
  };
}

export const supabaseCampaignsRepository: CampaignsRepository = {
  async list() {
    const { data, error } = await (supabase as any)
      .from('crm_campaigns')
      .select(CAMPAIGN_COLS)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const ids = rows.map((r: any) => r.id);
    const [stepsMap, triggersMap, metricsMap] = await Promise.all([
      loadSteps(ids),
      loadTriggers(ids),
      loadMetrics(ids),
    ]);
    return rows.map((r: any) =>
      campaignRowToDomain(
        r,
        stepsMap.get(r.id) ?? [],
        triggersMap.get(r.id) ?? [],
        metricsMap.get(r.id) ?? { enrolled: 0, active: 0, completed: 0, responseRate: 0, suppressed: 0, failed: 0 },
      ),
    );
  },

  async get(id) {
    const { data, error } = await (supabase as any)
      .from('crm_campaigns').select(CAMPAIGN_COLS).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const [stepsMap, triggersMap, metricsMap] = await Promise.all([
      loadSteps([id]), loadTriggers([id]), loadMetrics([id]),
    ]);
    return campaignRowToDomain(
      data,
      stepsMap.get(id) ?? [],
      triggersMap.get(id) ?? [],
      metricsMap.get(id) ?? { enrolled: 0, active: 0, completed: 0, responseRate: 0, suppressed: 0, failed: 0 },
    );
  },

  async create(input) {
    const row: Record<string, unknown> = {
      tenant_id: input.tenantId,
      name: input.name,
      description: input.description ?? input.purpose ?? null,
      is_active: input.status === 'Active',
      created_by_profile_id: input.ownerId ?? null,
    };
    const { data, error } = await (supabase as any)
      .from('crm_campaigns').insert(row).select(CAMPAIGN_COLS).single();
    if (error) throw new Error(error.message);
    return campaignRowToDomain(data, [], [], {
      enrolled: 0, active: 0, completed: 0, responseRate: 0, suppressed: 0, failed: 0,
    });
  },

  async update(id, patch) {
    const out: Record<string, unknown> = {};
    if (patch.name !== undefined) out.name = patch.name;
    if (patch.description !== undefined) out.description = patch.description ?? null;
    if (patch.status !== undefined) out.is_active = patch.status === 'Active';
    if (patch.ownerId !== undefined) out.created_by_profile_id = patch.ownerId ?? null;
    const { data, error } = await (supabase as any)
      .from('crm_campaigns').update(out).eq('id', id).select(CAMPAIGN_COLS).single();
    if (error) throw new Error(error.message);
    const [stepsMap, triggersMap, metricsMap] = await Promise.all([
      loadSteps([id]), loadTriggers([id]), loadMetrics([id]),
    ]);
    return campaignRowToDomain(
      data,
      stepsMap.get(id) ?? [],
      triggersMap.get(id) ?? [],
      metricsMap.get(id) ?? { enrolled: 0, active: 0, completed: 0, responseRate: 0, suppressed: 0, failed: 0 },
    );
  },

  async enrollments(campaignId) {
    const [enrRes, stepsRes] = await Promise.all([
      (supabase as any)
        .from('crm_campaign_enrollments')
        .select(ENROLL_COLS)
        .eq('campaign_id', campaignId)
        .order('enrolled_at', { ascending: false }),
      (supabase as any)
        .from('crm_campaign_steps')
        .select('id, campaign_id, step_order')
        .eq('campaign_id', campaignId),
    ]);
    if (enrRes.error) throw new Error(enrRes.error.message);
    if (stepsRes.error) throw new Error(stepsRes.error.message);
    const stepIdByOrder = new Map<string, string>();
    for (const s of stepsRes.data ?? []) {
      stepIdByOrder.set(`${s.campaign_id}:${s.step_order}`, s.id);
    }
    return (enrRes.data ?? []).map((r: any) => enrollmentToDomain(r, stepIdByOrder));
  },

  async enroll(campaignId, clientIds) {
    const { data: camp, error: campErr } = await (supabase as any)
      .from('crm_campaigns').select('tenant_id').eq('id', campaignId).single();
    if (campErr) throw new Error(campErr.message);
    const rows = clientIds.map((cid) => ({
      campaign_id: campaignId,
      client_id: cid,
      tenant_id: camp.tenant_id,
      status: 'active',
      current_step: 0,
    }));
    const { data, error } = await (supabase as any)
      .from('crm_campaign_enrollments').insert(rows).select(ENROLL_COLS);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => enrollmentToDomain(r, new Map()));
  },

  async pauseEnrollment(enrollmentId) {
    const { data, error } = await (supabase as any)
      .from('crm_campaign_enrollments')
      .update({ status: 'paused', paused_at: new Date().toISOString() })
      .eq('id', enrollmentId).select(ENROLL_COLS).single();
    if (error) throw new Error(error.message);
    return enrollmentToDomain(data, new Map());
  },

  async resumeEnrollment(enrollmentId) {
    const { data, error } = await (supabase as any)
      .from('crm_campaign_enrollments')
      .update({ status: 'active', pause_reason: null, paused_at: null })
      .eq('id', enrollmentId).select(ENROLL_COLS).single();
    if (error) throw new Error(error.message);
    return enrollmentToDomain(data, new Map());
  },

  async cancelEnrollment(enrollmentId, reason) {
    const { data, error } = await (supabase as any)
      .from('crm_campaign_enrollments')
      .update({ status: 'canceled', pause_reason: reason, completed_at: new Date().toISOString() })
      .eq('id', enrollmentId).select(ENROLL_COLS).single();
    if (error) throw new Error(error.message);
    return enrollmentToDomain(data, new Map());
  },

  async restartEnrollment(enrollmentId) {
    const { data, error } = await (supabase as any)
      .from('crm_campaign_enrollments')
      .update({ status: 'active', current_step: 0, completed_at: null, pause_reason: null, paused_at: null })
      .eq('id', enrollmentId).select(ENROLL_COLS).single();
    if (error) throw new Error(error.message);
    return enrollmentToDomain(data, new Map());
  },
};
