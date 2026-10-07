import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataProvider } from '@/services/dataProvider';
import type { ListTasksQuery } from '@/repositories/types';
import type { TaskStatus, CrmTask } from '@/domain/operations';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { buildTaskViewDateBounds, resolveOperatorTimeZone } from '@/lib/crm/taskViewDates';

const taskKeys = { all: ['crm-tasks'] as const, list: (q: ListTasksQuery) => ['crm-tasks', 'list', q] as const };

export function buildCanonicalTaskListQuery(
  q: ListTasksQuery,
  context: {
    tenantId: string | null;
    profileId: string;
    now?: Date;
    timeZone?: string;
  },
): ListTasksQuery | null {
  if (!context.tenantId || !context.profileId) return null;

  const needsCalendarBounds = q.view === 'due-today' || q.view === 'due-week';
  const dateBounds = needsCalendarBounds
    ? buildTaskViewDateBounds(
        context.now ?? new Date(),
        context.timeZone ?? resolveOperatorTimeZone(),
      )
    : undefined;

  return {
    ...q,
    tenantId: context.tenantId,
    currentProfileId: context.profileId,
    ...(dateBounds ? { dateBounds } : {}),
  };
}

export function useTasks(q: ListTasksQuery = {}) {
  const { currentTenantId, userId, isAuthenticated, isLoading } = useCrmAuth();
  const taskQuery = buildCanonicalTaskListQuery(q, {
    tenantId: currentTenantId,
    profileId: userId,
  });

  return useQuery({
    queryKey: taskKeys.list(taskQuery ?? q),
    queryFn: () => {
      if (!taskQuery) throw new Error('Task query requires an authenticated CRM operating context');
      return dataProvider.tasks.list(taskQuery);
    },
    enabled: !isLoading && isAuthenticated && Boolean(taskQuery),
  });
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const { currentTenantId } = useCrmAuth();
  const tenantId = () => {
    if (!currentTenantId) throw new Error('Current CRM operating tenant is required');
    return currentTenantId;
  };
  const invalidate = () => qc.invalidateQueries({ queryKey: taskKeys.all });
  return {
    create: useMutation({ mutationFn: (input: Omit<CrmTask, 'id' | 'createdAt' | 'updatedAt'>) => dataProvider.tasks.create(tenantId(), input), onSuccess: invalidate }),
    update: useMutation({ mutationFn: (p: { id: string; patch: Partial<CrmTask> }) => dataProvider.tasks.update(tenantId(), p.id, p.patch), onSuccess: invalidate }),
    complete: useMutation({ mutationFn: (id: string) => dataProvider.tasks.complete(tenantId(), id), onSuccess: invalidate }),
    reassign: useMutation({ mutationFn: (p: { ids: string[]; ownerId: string }) => dataProvider.tasks.reassign(tenantId(), p.ids, p.ownerId), onSuccess: invalidate }),
    bulkStatus: useMutation({ mutationFn: (p: { ids: string[]; status: TaskStatus }) => dataProvider.tasks.bulkStatus(tenantId(), p.ids, p.status), onSuccess: invalidate }),
    bulkDueDate: useMutation({ mutationFn: (p: { ids: string[]; dueAt: string }) => dataProvider.tasks.bulkDueDate(tenantId(), p.ids, p.dueAt), onSuccess: invalidate }),
  };
}

export function useExceptions() {
  const { currentTenantId, isAuthenticated, isLoading } = useCrmAuth();
  return useQuery({
    queryKey: ['crm-exceptions', currentTenantId],
    queryFn: () => {
      if (!currentTenantId) throw new Error('Current CRM operating tenant is required');
      return dataProvider.exceptions.list(currentTenantId);
    },
    enabled: !isLoading && isAuthenticated && !!currentTenantId,
  });
}

export function useExceptionMutations() {
  const qc = useQueryClient();
  const { currentTenantId } = useCrmAuth();
  const tenantId = () => {
    if (!currentTenantId) throw new Error('Current CRM operating tenant is required');
    return currentTenantId;
  };
  const invalidate = () => qc.invalidateQueries({ queryKey: ['crm-exceptions'] });
  return {
    resolve: useMutation({ mutationFn: (p: { id: string; note?: string }) => dataProvider.exceptions.resolve(tenantId(), p.id, p.note), onSuccess: invalidate }),
    dismiss: useMutation({ mutationFn: (p: { id: string; note?: string }) => dataProvider.exceptions.dismiss(tenantId(), p.id, p.note), onSuccess: invalidate }),
    reassign: useMutation({ mutationFn: (p: { id: string; ownerId: string }) => dataProvider.exceptions.reassign(tenantId(), p.id, p.ownerId), onSuccess: invalidate }),
    createTask: useMutation({ mutationFn: (id: string) => dataProvider.exceptions.createTaskFromException(tenantId(), id), onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['crm-tasks'] }); } }),
  };
}

export function useCampaigns() {
  const { currentTenantId, isAuthenticated, isLoading } = useCrmAuth();
  return useQuery({
    queryKey: ['crm-campaigns', currentTenantId],
    queryFn: () => {
      if (!currentTenantId) throw new Error('Current CRM operating tenant is required');
      return dataProvider.campaigns.list(currentTenantId);
    },
    enabled: !isLoading && isAuthenticated && !!currentTenantId,
  });
}
export function useCampaign(id?: string) {
  const { currentTenantId, isAuthenticated, isLoading } = useCrmAuth();
  return useQuery({
    queryKey: ['crm-campaigns', currentTenantId, id],
    queryFn: () => (id && currentTenantId ? dataProvider.campaigns.get(currentTenantId, id) : Promise.resolve(null)),
    enabled: !isLoading && isAuthenticated && !!currentTenantId && !!id,
  });
}
export function useEnrollments(campaignId?: string) {
  const { currentTenantId, isAuthenticated, isLoading } = useCrmAuth();
  return useQuery({
    queryKey: ['crm-enrollments', currentTenantId, campaignId],
    queryFn: () => (campaignId && currentTenantId ? dataProvider.campaigns.enrollments(currentTenantId, campaignId) : Promise.resolve([])),
    enabled: !isLoading && isAuthenticated && !!currentTenantId && !!campaignId,
  });
}

export function useStaffList() {
  const { currentTenantId, isAuthenticated, isLoading } = useCrmAuth();
  return useQuery({
    queryKey: ['crm-staff', currentTenantId],
    queryFn: () => {
      if (!currentTenantId) throw new Error('Current CRM operating tenant is required');
      return dataProvider.staff.list(currentTenantId);
    },
    enabled: !isLoading && isAuthenticated && !!currentTenantId,
  });
}

export function useClientAudit(clientId?: string) {
  const { currentTenantId, isAuthenticated, isLoading } = useCrmAuth();
  return useQuery({
    queryKey: ['crm-audit', currentTenantId, clientId],
    queryFn: () => (clientId && currentTenantId ? dataProvider.audit.listForClient(currentTenantId, clientId) : Promise.resolve([])),
    enabled: !isLoading && isAuthenticated && !!currentTenantId && !!clientId,
  });
}

export function useClientCommunications(clientId?: string) {
  const { currentTenantId, isAuthenticated, isLoading } = useCrmAuth();
  return useQuery({
    queryKey: ['crm-comms', currentTenantId, clientId],
    queryFn: () => (clientId && currentTenantId ? dataProvider.communications.listForClient(currentTenantId, clientId) : Promise.resolve([])),
    enabled: !isLoading && isAuthenticated && !!currentTenantId && !!clientId,
  });
}

export function useMessageThreads(channel: 'sms' | 'email') {
  const { currentTenantId, isAuthenticated, isLoading } = useCrmAuth();
  return useQuery({
    queryKey: ['crm-comms', currentTenantId, 'threads', channel],
    queryFn: () => {
      if (!currentTenantId) throw new Error('Current CRM operating tenant is required');
      return dataProvider.communications.listThreads(currentTenantId, channel);
    },
    enabled: !isLoading && isAuthenticated && !!currentTenantId,
  });
}

export function useReports() {
  const { currentTenantId: tenantId, isAuthenticated } = useCrmAuth();
  const enabled = isAuthenticated && !!tenantId;

  return {
    funnel: useQuery({
      queryKey: ['report-funnel', tenantId],
      queryFn: () => dataProvider.reports.journeyFunnel(tenantId),
      enabled,
    }),
    engagement: useQuery({
      queryKey: ['report-engagement', tenantId],
      queryFn: () => dataProvider.reports.engagementMetrics(tenantId),
      enabled,
    }),
    closure: useQuery({
      queryKey: ['report-closure', tenantId],
      queryFn: () => dataProvider.reports.closureMetrics(tenantId),
      enabled,
    }),
    campaign: useQuery({
      queryKey: ['report-campaign', tenantId],
      queryFn: () => dataProvider.reports.campaignPerformance(tenantId),
      enabled,
    }),
    task: useQuery({
      queryKey: ['report-task', tenantId],
      queryFn: () => dataProvider.reports.taskPerformance(tenantId),
      enabled,
    }),
    exception: useQuery({
      queryKey: ['report-exception', tenantId],
      queryFn: () => dataProvider.reports.exceptionMetrics(tenantId),
      enabled,
    }),
  };
}
