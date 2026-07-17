import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import type { CampaignsRepository } from '../types';
import type {
  Campaign, CampaignEnrollment, CampaignStep, CampaignStatus,
} from '@/domain/operations';

type CampaignRow = Tables<'crm_campaigns'>;
type CampaignInsert = TablesInsert<'crm_campaigns'>;
type CampaignUpdate = TablesUpdate<'crm_campaigns'>;
type CampaignStepRow = Tables<'crm_campaign_steps'>;
type EnrollmentRow = Pick<
  Tables<'crm_campaign_enrollments'>,
  | 'id'
  | 'campaign_id'
  | 'client_id'
  | 'tenant_id'
  | 'status'
  | 'current_step'
  | 'pause_reason'
  | 'enrolled_at'
  | 'completed_at'
  | 'enrolled_by_profile_id'
  | 'created_at'
  | 'updated_at'
>;

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

function stepToDomain(r: CampaignStepRow): CampaignStep {
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
  const { data, error } = await supabase
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
  const enrRes = await supabase
    .from('crm_campaign_enrollments')
    .select('campaign_id, status')
    .in('campaign_id', campaignIds);
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

function mapStatus(r: CampaignRow, hasActiveEnrollments: boolean): CampaignStatus {
  if (!r.is_active) return 'Paused';
  if (hasActiveEnrollments) return 'Active';
  return 'Active';
}

async function loadTriggers(campaignIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!campaignIds.length) return map;
  const { data, error } = await supabase
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
  r: CampaignRow,
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
  r: EnrollmentRow,
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
    const { data, error } = await supabase
      .from('crm_campaigns')
      .select(CAMPAIGN_COLS)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const ids = rows.map((r) => r.id);
    const [stepsMap, triggersMap, metricsMap] = await Promise.all([
      loadSteps(ids),
      loadTriggers(ids),
      loadMetrics(ids),
    ]);
    return rows.map((r) =>
      campaignRowToDomain(
        r,
        stepsMap.get(r.id) ?? [],
        triggersMap.get(r.id) ?? [],
        metricsMap.get(r.id) ?? { enrolled: 0, active: 0, completed: 0, responseRate: 0, suppressed: 0, failed: 0 },
      ),
    );
  },

  async get(id) {
    const { data, error } = await supabase
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
    const row: CampaignInsert = {
      tenant_id: input.tenantId,
      name: input.name,
      description: input.description ?? input.purpose ?? null,
      is_active: input.status === 'Active',
      created_by_profile_id: input.ownerId ?? null,
    };
    const { data, error } = await supabase
      .from('crm_campaigns').insert(row).select(CAMPAIGN_COLS).single();
    if (error) throw new Error(error.message);
    return campaignRowToDomain(data, [], [], {
      enrolled: 0, active: 0, completed: 0, responseRate: 0, suppressed: 0, failed: 0,
    });
  },

  async update(id, patch) {
    const out: CampaignUpdate = {};
    if (patch.name !== undefined) out.name = patch.name;
    if (patch.description !== undefined) out.description = patch.description ?? null;
    if (patch.status !== undefined) out.is_active = patch.status === 'Active';
    if (patch.ownerId !== undefined) out.created_by_profile_id = patch.ownerId ?? null;
    const { data, error } = await supabase
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
      supabase
        .from('crm_campaign_enrollments')
        .select(ENROLL_COLS)
        .eq('campaign_id', campaignId)
        .order('enrolled_at', { ascending: false }),
      supabase
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
    return (enrRes.data ?? []).map((r) => enrollmentToDomain(r, stepIdByOrder));
  },

  async enroll(campaignId, clientIds) {
    if (!clientIds.length) return [];
    // Untyped RPC call (types.ts regenerates post-migration).
    const rpc = (supabase as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc;
    const { data, error } = await rpc('crm_enroll_clients_in_campaign', {
      p_campaign_id: campaignId,
      p_client_ids: clientIds,
      p_reason: 'manual_enrollment',
      p_idempotency_key: crypto.randomUUID(),
      p_contract_version: 'valorwell-crm-contracts@1.0.1+20260714',
    });
    if (error) throw new Error(error.message);
    const results = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    const enrolledIds = results
      .filter((r) => r.status === 'enrolled' && typeof r.enrollment_id === 'string')
      .map((r) => r.enrollment_id as string);
    if (!enrolledIds.length) return [];
    const { data: rows, error: fetchErr } = await supabase
      .from('crm_campaign_enrollments').select(ENROLL_COLS).in('id', enrolledIds);
    if (fetchErr) throw new Error(fetchErr.message);
    return (rows ?? []).map((r) => enrollmentToDomain(r, new Map()));
  },


  async pauseEnrollment(enrollmentId, reason) {
    return await enrollmentActionRpc('crm_pause_enrollment', enrollmentId, reason);
  },

  async resumeEnrollment(enrollmentId, reason) {
    return await enrollmentActionRpc('crm_resume_enrollment', enrollmentId, reason);
  },

  async cancelEnrollment(enrollmentId, reason) {
    return await enrollmentActionRpc('crm_cancel_enrollment', enrollmentId, reason);
  },

  async restartEnrollment(enrollmentId, reason) {
    return await enrollmentActionRpc('crm_restart_enrollment', enrollmentId, reason);
  },
};

async function enrollmentActionRpc(
  rpcName: string,
  enrollmentId: string,
  reason: string,
): Promise<CampaignEnrollment> {
  if (!reason || reason.trim().length < 3) {
    throw new Error('A reason (min 3 chars) is required for enrollment state changes.');
  }
  const rpc = (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc;
  const { error } = await rpc(rpcName, {
    p_enrollment_id: enrollmentId,
    p_reason: reason,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  const { data: row, error: fetchErr } = await supabase
    .from('crm_campaign_enrollments').select(ENROLL_COLS).eq('id', enrollmentId).single();
  if (fetchErr) throw new Error(fetchErr.message);
  return enrollmentToDomain(row, new Map());
}
