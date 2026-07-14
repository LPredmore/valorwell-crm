import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import type { ExceptionsRepository } from '../types';
import type {
  OperationalException, ExceptionStatus, ExceptionSeverity, ExceptionType, CrmTask,
} from '@/domain/operations';

type ExceptionRow = Database['public']['Tables']['crm_exceptions']['Row'];

const STATUS_D2D: Record<ExceptionStatus, string> = {
  Open: 'open', 'In Review': 'in_review', Resolved: 'resolved', Dismissed: 'dismissed',
};
const STATUS_B2D: Record<string, ExceptionStatus> = Object.fromEntries(
  Object.entries(STATUS_D2D).map(([d, db]) => [db, d as ExceptionStatus]),
);
const SEVERITY_B2D: Record<string, ExceptionSeverity> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
};
const TYPE_B2D: Record<string, ExceptionType> = {
  campaign_message_failed: 'Campaign Message Failed',
  campaign_step_overdue: 'Campaign Step Overdue',
  client_reply_needs_review: 'Client Reply Needs Review',
  client_went_dark: 'Client Went Dark',
  client_became_at_risk: 'Client Became At Risk',
  missed_appointment_follow_up: 'Missed Appointment Follow-Up',
  eligibility_verification_failed: 'Eligibility Verification Failed',
  no_clinician_match_found: 'No Clinician Match Found',
  communication_suppressed: 'Communication Suppressed',
  assignment_missing: 'Assignment Missing',
  data_conflict: 'Data Conflict',
  integration_failure: 'Integration Failure',
  manual_review_required: 'Manual Review Required',
};

const COLS = `
  id, tenant_id, type, severity, status, client_id, campaign_id, workflow,
  owner_id, due_at, last_activity_at, summary, recommended_resolution,
  resolution_history, created_at, updated_at
`;

function toDomain(r: ExceptionRow): OperationalException {
  return {
    id: r.id, tenantId: r.tenant_id,
    type: TYPE_B2D[r.type] ?? 'Manual Review Required',
    severity: SEVERITY_B2D[r.severity] ?? 'Medium',
    status: STATUS_B2D[r.status] ?? 'Open',
    clientId: r.client_id ?? undefined, campaignId: r.campaign_id ?? undefined,
    workflow: r.workflow ?? undefined, ownerId: r.owner_id ?? undefined,
    createdAt: r.created_at, dueAt: r.due_at ?? undefined,
    lastActivityAt: r.last_activity_at,
    summary: r.summary, recommendedResolution: r.recommended_resolution ?? undefined,
    resolutionHistory: jsonArray(r.resolution_history),
  };
}

function jsonArray(value: Json | null): Json[] {
  return Array.isArray(value) ? value : [];
}

async function updateStatus(id: string, status: ExceptionStatus, note?: string) {
  const { data: cur } = await supabase.from('crm_exceptions').select('resolution_history').eq('id', id).maybeSingle();
  const history = [...jsonArray(cur?.resolution_history ?? null), { at: new Date().toISOString(), action: status, note }];
  const { data, error } = await supabase.from('crm_exceptions')
    .update({ status: STATUS_D2D[status], resolution_history: history, last_activity_at: new Date().toISOString() })
    .eq('id', id).select(COLS).single();
  if (error) throw new Error(error.message);
  return toDomain(data);
}

export const supabaseExceptionsRepository: ExceptionsRepository = {
  async list(q) {
    let query = supabase.from('crm_exceptions').select(COLS).order('last_activity_at', { ascending: false });
    if (q?.status?.length) query = query.in('status', q.status.map(s => STATUS_D2D[s]));
    if (q?.ownerId) query = query.eq('owner_id', q.ownerId);
    if (q?.clientId) query = query.eq('client_id', q.clientId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(toDomain);
  },
  async get(id) {
    const { data, error } = await supabase.from('crm_exceptions').select(COLS).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toDomain(data) : null;
  },
  async resolve(id, note) { return updateStatus(id, 'Resolved', note); },
  async dismiss(id, note) { return updateStatus(id, 'Dismissed', note); },
  async reassign(id, ownerId) {
    const { data, error } = await supabase.from('crm_exceptions')
      .update({ owner_id: ownerId, last_activity_at: new Date().toISOString() })
      .eq('id', id).select(COLS).single();
    if (error) throw new Error(error.message);
    return toDomain(data);
  },
  async createTaskFromException(id): Promise<CrmTask> {
    const { data: exc, error: eErr } = await supabase.from('crm_exceptions').select(COLS).eq('id', id).maybeSingle();
    if (eErr) throw new Error(eErr.message);
    if (!exc) throw new Error('Exception not found');
    const { data: uid } = await supabase.auth.getUser();
    const insert = {
      tenant_id: exc.tenant_id,
      title: `Resolve: ${exc.summary}`,
      description: exc.recommended_resolution ?? null,
      client_id: exc.client_id,
      campaign_id: exc.campaign_id,
      exception_id: exc.id,
      type: 'campaign_exception',
      priority: exc.severity === 'critical' ? 'urgent' : exc.severity === 'high' ? 'high' : 'normal',
      status: 'not_started',
      owner_id: exc.owner_id,
      created_by_profile_id: uid?.user?.id,
    };
    const { data, error } = await supabase.from('crm_tasks').insert(insert).select('*').single();
    if (error) throw new Error(error.message);
    return {
      id: data.id, tenantId: data.tenant_id, title: data.title, description: data.description ?? undefined,
      clientId: data.client_id ?? undefined, campaignId: data.campaign_id ?? undefined,
      exceptionId: data.exception_id ?? undefined, type: 'Campaign Exception',
      priority: 'Normal', status: 'Not Started', ownerId: data.owner_id ?? undefined,
      collaboratorIds: [], createdByProfileId: data.created_by_profile_id,
      checklist: [], tags: [], createdAt: data.created_at, updatedAt: data.updated_at,
    } as CrmTask;
  },
};
