import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import type { TasksRepository, ListTasksQuery } from '../types';
import type { CrmTask, TaskStatus, TaskPriority, TaskType } from '@/domain/operations';

type Row = Tables<'crm_tasks'>;
type TaskInsert = TablesInsert<'crm_tasks'>;
type TaskUpdate = TablesUpdate<'crm_tasks'>;
type TaskDbStatus = Row['status'];
type TaskDbPriority = Row['priority'];
type TaskDbType = Row['type'];

const TASK_STATUS_D2D: Record<TaskStatus, TaskDbStatus> = {
  'Not Started': 'not_started', 'In Progress': 'in_progress', Waiting: 'waiting',
  Blocked: 'blocked', Completed: 'completed', Canceled: 'canceled',
};
const TASK_STATUS_B2D: Record<TaskDbStatus, TaskStatus> = {
  not_started: 'Not Started', in_progress: 'In Progress', waiting: 'Waiting',
  blocked: 'Blocked', completed: 'Completed', canceled: 'Canceled',
};
const TASK_PRIO_D2D: Record<TaskPriority, TaskDbPriority> = {
  Low: 'low', Normal: 'normal', High: 'high', Urgent: 'urgent',
};
const TASK_PRIO_B2D: Record<TaskDbPriority, TaskPriority> = {
  low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent',
};
const TASK_TYPE_D2D: Record<TaskType, TaskDbType> = {
  'Client Follow-Up': 'client_follow_up', 'Staff Follow-Up': 'staff_follow_up',
  'Campaign Exception': 'campaign_exception', 'Eligibility Review': 'eligibility_review',
  'Match Review': 'match_review', Documentation: 'documentation',
  'Risk Intervention': 'risk_intervention', General: 'general',
};
const TASK_TYPE_B2D: Record<TaskDbType, TaskType> = {
  client_follow_up: 'Client Follow-Up', staff_follow_up: 'Staff Follow-Up',
  campaign_exception: 'Campaign Exception', eligibility_review: 'Eligibility Review',
  match_review: 'Match Review', documentation: 'Documentation',
  risk_intervention: 'Risk Intervention', general: 'General',
};

const COLS = `
  id, tenant_id, title, description, client_id, staff_id, campaign_id, exception_id,
  type, priority, status, owner_id, collaborator_ids, created_by_profile_id,
  start_at, due_at, completed_at, recurrence, checklist, tags, created_at, updated_at
`;

function toDomain(r: Row): CrmTask {
  return {
    id: r.id, tenantId: r.tenant_id, title: r.title, description: r.description ?? undefined,
    clientId: r.client_id ?? undefined, staffId: r.staff_id ?? undefined,
    campaignId: r.campaign_id ?? undefined, exceptionId: r.exception_id ?? undefined,
    type: TASK_TYPE_B2D[r.type] ?? 'General',
    priority: TASK_PRIO_B2D[r.priority] ?? 'Normal',
    status: TASK_STATUS_B2D[r.status] ?? 'Not Started',
    ownerId: r.owner_id ?? undefined,
    collaboratorIds: r.collaborator_ids ?? [],
    createdByProfileId: r.created_by_profile_id,
    startAt: r.start_at ?? undefined, dueAt: r.due_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
    recurrence: recurrenceFromDb(r.recurrence),
    checklist: checklistFromDb(r.checklist),
    tags: r.tags ?? [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function recurrenceFromDb(value: string | null): CrmTask['recurrence'] {
  switch (value?.toLowerCase()) {
    case 'none': return 'None';
    case 'daily': return 'Daily';
    case 'weekly': return 'Weekly';
    case 'monthly': return 'Monthly';
    default: return undefined;
  }
}

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checklistFromDb(value: Json): CrmTask['checklist'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !isJsonObject(item)
      || typeof item.id !== 'string'
      || typeof item.label !== 'string'
      || typeof item.done !== 'boolean'
    ) {
      return [];
    }
    return [{ id: item.id, label: item.label, done: item.done }];
  });
}

function checklistToDb(value: CrmTask['checklist']): Json {
  return value.map((item) => ({ id: item.id, label: item.label, done: item.done }));
}

function isTaskType(value: string): value is TaskType {
  return Object.prototype.hasOwnProperty.call(TASK_TYPE_D2D, value);
}

function toDb(patch: Partial<CrmTask>): TaskUpdate {
  const out: TaskUpdate = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.description !== undefined) out.description = patch.description ?? null;
  if (patch.clientId !== undefined) out.client_id = patch.clientId ?? null;
  if (patch.staffId !== undefined) out.staff_id = patch.staffId ?? null;
  if (patch.campaignId !== undefined) out.campaign_id = patch.campaignId ?? null;
  if (patch.exceptionId !== undefined) out.exception_id = patch.exceptionId ?? null;
  if (patch.type !== undefined) out.type = TASK_TYPE_D2D[patch.type];
  if (patch.priority !== undefined) out.priority = TASK_PRIO_D2D[patch.priority];
  if (patch.status !== undefined) out.status = TASK_STATUS_D2D[patch.status];
  if (patch.ownerId !== undefined) out.owner_id = patch.ownerId ?? null;
  if (patch.collaboratorIds !== undefined) out.collaborator_ids = patch.collaboratorIds;
  if (patch.startAt !== undefined) out.start_at = patch.startAt ?? null;
  if (patch.dueAt !== undefined) out.due_at = patch.dueAt ?? null;
  if (patch.completedAt !== undefined) out.completed_at = patch.completedAt ?? null;
  if (patch.recurrence !== undefined) out.recurrence = patch.recurrence ?? null;
  if (patch.checklist !== undefined) out.checklist = checklistToDb(patch.checklist);
  if (patch.tags !== undefined) out.tags = patch.tags;
  if (patch.tenantId !== undefined) out.tenant_id = patch.tenantId;
  if (patch.createdByProfileId !== undefined) out.created_by_profile_id = patch.createdByProfileId;
  return out;
}

function toInsert(input: Parameters<TasksRepository['create']>[0]): TaskInsert {
  return {
    ...toDb(input),
    tenant_id: input.tenantId,
    title: input.title,
    created_by_profile_id: input.createdByProfileId,
  };
}

export const supabaseTasksRepository: TasksRepository = {
  async list(q: ListTasksQuery): Promise<CrmTask[]> {
    let query = supabase.from('crm_tasks').select(COLS).order('due_at', { ascending: true, nullsFirst: false });
    if (q.clientId) query = query.eq('client_id', q.clientId);
    if (q.ownerIds?.length) query = query.in('owner_id', q.ownerIds);
    if (q.statuses?.length) query = query.in('status', q.statuses.map(s => TASK_STATUS_D2D[s]));
    if (q.dueBefore) query = query.lte('due_at', q.dueBefore);
    if (q.dueAfter) query = query.gte('due_at', q.dueAfter);
    if (q.types?.length) {
      const types = q.types.filter(isTaskType).map((type) => TASK_TYPE_D2D[type]);
      if (!types.length) return [];
      query = query.in('type', types);
    }
    if (q.search) {
      const s = q.search.replace(/[,()]/g, ' ');
      query = query.or(`title.ilike.%${s}%,description.ilike.%${s}%`);
    }
    if (q.view === 'overdue') {
      query = query.lt('due_at', new Date().toISOString()).not('status', 'in', '(completed,canceled)');
    } else if (q.view === 'unassigned') {
      query = query.is('owner_id', null);
    } else if (q.view === 'recently-completed') {
      query = query.eq('status', 'completed');
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(toDomain);
  },

  async get(id) {
    const { data, error } = await supabase.from('crm_tasks').select(COLS).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toDomain(data) : null;
  },

  async create(input) {
    const row = toInsert(input);
    const { data, error } = await supabase.from('crm_tasks').insert(row).select(COLS).single();
    if (error) throw new Error(error.message);
    return toDomain(data);
  },

  async update(id, patch) {
    const { data, error } = await supabase
      .from('crm_tasks').update(toDb(patch)).eq('id', id).select(COLS).single();
    if (error) throw new Error(error.message);
    return toDomain(data);
  },

  async complete(id) {
    return this.update(id, { status: 'Completed', completedAt: new Date().toISOString() });
  },

  async reassign(ids, ownerId) {
    const { error } = await supabase.from('crm_tasks').update({ owner_id: ownerId }).in('id', ids);
    if (error) throw new Error(error.message);
  },

  async bulkStatus(ids, status) {
    const { error } = await supabase
      .from('crm_tasks').update({ status: TASK_STATUS_D2D[status] }).in('id', ids);
    if (error) throw new Error(error.message);
  },

  async bulkDueDate(ids, dueAt) {
    const { error } = await supabase.from('crm_tasks').update({ due_at: dueAt }).in('id', ids);
    if (error) throw new Error(error.message);
  },
};
