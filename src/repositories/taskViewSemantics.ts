import type { CrmTask, TaskType } from '@/domain/operations';
import type { TaskView } from '@/domain/taskViews';
import type { ListTasksQuery } from './types';

export interface TaskViewPlan {
  tenantId?: string;
  ownerId?: string;
  ownerIsNull?: boolean;
  excludeTerminal: boolean;
  completedOnly?: boolean;
  dueGte?: string;
  dueLt?: string;
  type?: TaskType;
  orderBy: 'dueAt' | 'completedAt';
  orderAscending: boolean;
}

function requireTenant(q: ListTasksQuery): string {
  if (!q.tenantId) throw new Error(`Task view "${q.view ?? 'unknown'}" requires current tenant context`);
  return q.tenantId;
}

function requireCurrentProfile(q: ListTasksQuery): string {
  if (!q.currentProfileId) throw new Error('My Tasks requires current operator profile context');
  return q.currentProfileId;
}

function requireDateBounds(q: ListTasksQuery) {
  if (!q.dateBounds) throw new Error(`Task view "${q.view ?? 'unknown'}" requires local date boundaries`);
  return q.dateBounds;
}

function activePlan(tenantId: string): TaskViewPlan {
  return {
    tenantId,
    excludeTerminal: true,
    orderBy: 'dueAt',
    orderAscending: true,
  };
}

export function buildTaskViewPlan(q: ListTasksQuery): TaskViewPlan {
  if (!q.view) {
    return {
      tenantId: q.tenantId,
      excludeTerminal: false,
      orderBy: 'dueAt',
      orderAscending: true,
    };
  }

  const tenantId = requireTenant(q);
  switch (q.view satisfies TaskView) {
    case 'my':
      return { ...activePlan(tenantId), ownerId: requireCurrentProfile(q) };
    case 'team':
      return activePlan(tenantId);
    case 'overdue':
      return {
        ...activePlan(tenantId),
        dueLt: q.nowIso ?? new Date().toISOString(),
      };
    case 'due-today': {
      const bounds = requireDateBounds(q);
      return {
        ...activePlan(tenantId),
        dueGte: bounds.dayStartIso,
        dueLt: bounds.nextDayStartIso,
      };
    }
    case 'due-week': {
      const bounds = requireDateBounds(q);
      return {
        ...activePlan(tenantId),
        dueGte: bounds.weekStartIso,
        dueLt: bounds.nextWeekStartIso,
      };
    }
    case 'unassigned':
      return { ...activePlan(tenantId), ownerIsNull: true };
    case 'client-followups':
      return { ...activePlan(tenantId), type: 'Client Follow-Up' };
    case 'staff-followups':
      return { ...activePlan(tenantId), type: 'Staff Follow-Up' };
    case 'campaign-exceptions':
      return { ...activePlan(tenantId), type: 'Campaign Exception' };
    case 'recently-completed':
      return {
        tenantId,
        excludeTerminal: false,
        completedOnly: true,
        orderBy: 'completedAt',
        orderAscending: false,
      };
    case 'all':
      return {
        tenantId,
        excludeTerminal: false,
        orderBy: 'dueAt',
        orderAscending: true,
      };
    default:
      throw new Error(`Unsupported task view: ${String(q.view)}`);
  }
}

function isTerminal(task: CrmTask): boolean {
  return task.status === 'Completed' || task.status === 'Canceled';
}

export function taskMatchesViewPlan(task: CrmTask, plan: TaskViewPlan): boolean {
  if (plan.tenantId && task.tenantId !== plan.tenantId) return false;
  if (plan.ownerId && task.ownerId !== plan.ownerId) return false;
  if (plan.ownerIsNull && task.ownerId) return false;
  if (plan.excludeTerminal && isTerminal(task)) return false;
  if (plan.completedOnly && task.status !== 'Completed') return false;
  if (plan.type && task.type !== plan.type) return false;

  if (plan.dueGte || plan.dueLt) {
    if (!task.dueAt) return false;
    const due = new Date(task.dueAt).getTime();
    if (plan.dueGte && due < new Date(plan.dueGte).getTime()) return false;
    if (plan.dueLt && due >= new Date(plan.dueLt).getTime()) return false;
  }

  return true;
}

function sortableTime(value: string | undefined, nullValue: number): number {
  if (!value) return nullValue;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : nullValue;
}

export function sortTasksForViewPlan(tasks: readonly CrmTask[], plan: TaskViewPlan): CrmTask[] {
  return [...tasks].sort((left, right) => {
    if (plan.orderBy === 'completedAt') {
      const leftTime = sortableTime(left.completedAt, Number.NEGATIVE_INFINITY);
      const rightTime = sortableTime(right.completedAt, Number.NEGATIVE_INFINITY);
      if (leftTime !== rightTime) return plan.orderAscending ? leftTime - rightTime : rightTime - leftTime;
    } else {
      const leftTime = sortableTime(left.dueAt, Number.POSITIVE_INFINITY);
      const rightTime = sortableTime(right.dueAt, Number.POSITIVE_INFINITY);
      if (leftTime !== rightTime) return plan.orderAscending ? leftTime - rightTime : rightTime - leftTime;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}
