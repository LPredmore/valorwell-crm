import { supabase } from '@/integrations/supabase/client';
import { dataProvider } from '@/services/dataProvider';
import type { TaskPriority, TaskStatus } from '@/domain/operations';

/** Relationship subjects belong to the same canonical crm_tasks table used by My Tasks.
 * The two extra optional DB columns are additive and may not yet appear in
 * generated client types; no duplicate task store is created. */
export type RelationshipTaskSubject =
  | { contactId: string; organizationId?: never }
  | { organizationId: string; contactId?: never };
export interface RelationshipTaskRow {
  id: string;
  tenant_id: string;
  relationship_contact_id: string | null;
  relationship_organization_id: string | null;
  title: string;
  description: string | null;
  status: 'not_started' | 'in_progress' | 'waiting' | 'blocked' | 'completed' | 'canceled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  owner_id: string | null;
  due_at: string | null;
  completed_at: string | null;
  updated_at: string;
}
export const statusLabels: Record<RelationshipTaskRow['status'], TaskStatus> = {
  not_started: 'Not Started', in_progress: 'In Progress', waiting: 'Waiting',
  blocked: 'Blocked', completed: 'Completed', canceled: 'Canceled',
};
export const priorityValues: Record<TaskPriority, RelationshipTaskRow['priority']> = {
  Low: 'low', Normal: 'normal', High: 'high', Urgent: 'urgent',
};
export class RelationshipTasksNotDeployedError extends Error {
  constructor() {
    super('Relationship task linking is not deployed to Billing Hub yet.');
    this.name = 'RelationshipTasksNotDeployedError';
  }
}
function checkError(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (['42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '') ||
    /column.*relationship_(contact|organization)_id|schema cache/i.test(error.message)) {
    throw new RelationshipTasksNotDeployedError();
  }
  throw new Error(error.message);
}
function subjectFilter(query: ReturnType<ReturnType<typeof supabase.from>['select']>, subject: RelationshipTaskSubject) {
  return subject.contactId
    ? query.eq('relationship_contact_id', subject.contactId)
    : query.eq('relationship_organization_id', subject.organizationId!);
}
async function context(): Promise<{ tenantId: string; userId: string; canMutate: boolean }> {
  const { data, error } = await supabase.rpc('get_crm_operating_context');
  checkError(error);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('CRM operating context unavailable.');
  const tenantId = data.current_tenant_id;
  const userId = data.profile_id;
  if (data.authenticated !== true || typeof tenantId !== 'string' || typeof userId !== 'string')
    throw new Error('An authenticated CRM operating tenant is required.');
  const caps = data.capabilities;
  return { tenantId, userId, canMutate: typeof caps === 'object' && caps !== null && !Array.isArray(caps) && caps.mutate === true };
}

export const relationshipTasksRepository = {
  async list(subject: RelationshipTaskSubject): Promise<RelationshipTaskRow[]> {
    const { tenantId } = await context();
    // Select only task columns relevant to this non-clinical subject; never
    // fetch client task descriptions and then filter in browser memory.
    let query = supabase.from('crm_tasks')
      .select('id,tenant_id,relationship_contact_id,relationship_organization_id,title,description,status,priority,owner_id,due_at,completed_at,updated_at')
      .eq('tenant_id', tenantId);
    query = subject.contactId ? query.eq('relationship_contact_id', subject.contactId)
      : query.eq('relationship_organization_id', subject.organizationId!);
    const { data, error } = await query.order('due_at', { ascending: true, nullsFirst: false }).limit(100);
    checkError(error);
    return data as unknown as RelationshipTaskRow[];
  },
  async create(subject: RelationshipTaskSubject, input: {
    title: string; description?: string; priority: TaskPriority;
    ownerId?: string; dueAt?: string;
  }) {
    const ctx = await context();
    if (!ctx.canMutate) throw new Error('CRM task editing permission is required.');
    const title = input.title.trim();
    if (!title || title.length > 200) throw new Error('Enter a task title of 1–200 characters.');
    // Explicit insert of canonical crm_tasks row and relation in ONE transaction:
    // no orphan task is created if the subject link is invalid.
    const { data, error } = await supabase.from('crm_tasks')
      .insert({
        tenant_id: ctx.tenantId,
        created_by_profile_id: ctx.userId,
        title,
        description: input.description?.trim() || null,
        type: 'general',
        priority: priorityValues[input.priority],
        status: 'not_started',
        owner_id: input.ownerId || null,
        due_at: input.dueAt || null,
        relationship_contact_id: subject.contactId ?? null,
        relationship_organization_id: subject.organizationId ?? null,
      } as never)
      .select('id')
      .single();
    checkError(error);
    if (!data) throw new Error('Task was not returned after creation.');
    return data.id;
  },
  async complete(task: RelationshipTaskRow) {
    const ctx = await context();
    if (!ctx.canMutate || ctx.tenantId !== task.tenant_id)
      throw new Error('CRM task editing permission is required.');
    await dataProvider.tasks.complete(ctx.tenantId, task.id);
  },
  async update(task: RelationshipTaskRow, patch: {
    ownerId?: string | null; dueAt?: string | null; status?: TaskStatus; priority?: TaskPriority;
  }) {
    const ctx = await context();
    if (!ctx.canMutate || ctx.tenantId !== task.tenant_id)
      throw new Error('CRM task editing permission is required.');
    await dataProvider.tasks.update(ctx.tenantId, task.id, patch);
  },
};
