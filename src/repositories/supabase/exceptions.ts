import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables } from '@/integrations/supabase/types';
import type { ExceptionsRepository } from '../types';
import type {
  OperationalException, ExceptionStatus, ExceptionSeverity, ExceptionType, CrmTask, TaskPriority,
} from '@/domain/operations';
import { supabaseTasksRepository } from './tasks';

type ExceptionRow = Tables<'crm_exceptions'>;
type ExceptionDbStatus = ExceptionRow['status'];
type ResolutionHistoryEntry = OperationalException['resolutionHistory'][number];

const STATUS_D2D: Record<ExceptionStatus, ExceptionDbStatus> = {
  Open: 'open', 'In Review': 'in_review', Resolved: 'resolved', Dismissed: 'dismissed',
};
const STATUS_B2D: Record<ExceptionDbStatus, ExceptionStatus> = {
  open: 'Open', in_review: 'In Review', resolved: 'Resolved', dismissed: 'Dismissed',
};
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
    resolutionHistory: parseResolutionHistory(r.resolution_history),
  };
}

function jsonArray(value: Json | null): Json[] {
  return Array.isArray(value) ? value : [];
}

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResolutionHistory(value: Json | null): ResolutionHistoryEntry[] {
  return jsonArray(value).flatMap((entry) => {
    if (!isJsonObject(entry) || typeof entry.at !== 'string' || typeof entry.action !== 'string') {
      return [];
    }
    const byProfileId = typeof entry.byProfileId === 'string' ? entry.byProfileId : undefined;
    const note = typeof entry.note === 'string' ? entry.note : undefined;
    return [{
      at: entry.at,
      action: entry.action,
      ...(byProfileId !== undefined ? { byProfileId } : {}),
      ...(note !== undefined ? { note } : {}),
    }];
  });
}

async function updateStatus(id: string, status: ExceptionStatus, note?: string) {
  const { data: cur } = await supabase.from('crm_exceptions').select('resolution_history').eq('id', id).maybeSingle();
  const historyEntry: Json = {
    at: new Date().toISOString(),
    action: status,
    ...(note !== undefined ? { note } : {}),
  };
  const history: Json = [...jsonArray(cur?.resolution_history ?? null), historyEntry];
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
    const createdByProfileId = uid.user?.id;
    if (!createdByProfileId) throw new Error('Authenticated user required to create an exception task');
    const priority: TaskPriority =
      exc.severity === 'critical' ? 'Urgent' : exc.severity === 'high' ? 'High' : 'Normal';
    return supabaseTasksRepository.create({
      tenantId: exc.tenant_id,
      title: `Resolve: ${exc.summary}`,
      description: exc.recommended_resolution ?? undefined,
      clientId: exc.client_id ?? undefined,
      campaignId: exc.campaign_id ?? undefined,
      exceptionId: exc.id,
      type: 'Campaign Exception',
      priority,
      status: 'Not Started',
      ownerId: exc.owner_id ?? undefined,
      collaboratorIds: [],
      createdByProfileId,
      checklist: [],
      tags: [],
    });
  },
};
