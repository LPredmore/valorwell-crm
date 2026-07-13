import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataProvider } from '@/services/dataProvider';
import type { ListTasksQuery } from '@/repositories/types';
import type { TaskStatus, CrmTask } from '@/domain/operations';

const taskKeys = { all: ['crm-tasks'] as const, list: (q: ListTasksQuery) => ['crm-tasks', 'list', q] as const };

export function useTasks(q: ListTasksQuery = {}) {
  return useQuery({ queryKey: taskKeys.list(q), queryFn: () => dataProvider.tasks.list(q) });
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: taskKeys.all });
  return {
    create: useMutation({ mutationFn: (input: Omit<CrmTask, 'id' | 'createdAt' | 'updatedAt'>) => dataProvider.tasks.create(input), onSuccess: invalidate }),
    update: useMutation({ mutationFn: (p: { id: string; patch: Partial<CrmTask> }) => dataProvider.tasks.update(p.id, p.patch), onSuccess: invalidate }),
    complete: useMutation({ mutationFn: (id: string) => dataProvider.tasks.complete(id), onSuccess: invalidate }),
    reassign: useMutation({ mutationFn: (p: { ids: string[]; ownerId: string }) => dataProvider.tasks.reassign(p.ids, p.ownerId), onSuccess: invalidate }),
    bulkStatus: useMutation({ mutationFn: (p: { ids: string[]; status: TaskStatus }) => dataProvider.tasks.bulkStatus(p.ids, p.status), onSuccess: invalidate }),
    bulkDueDate: useMutation({ mutationFn: (p: { ids: string[]; dueAt: string }) => dataProvider.tasks.bulkDueDate(p.ids, p.dueAt), onSuccess: invalidate }),
  };
}

export function useExceptions() {
  return useQuery({ queryKey: ['crm-exceptions'], queryFn: () => dataProvider.exceptions.list() });
}

export function useExceptionMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['crm-exceptions'] });
  return {
    resolve: useMutation({ mutationFn: (p: { id: string; note?: string }) => dataProvider.exceptions.resolve(p.id, p.note), onSuccess: invalidate }),
    dismiss: useMutation({ mutationFn: (p: { id: string; note?: string }) => dataProvider.exceptions.dismiss(p.id, p.note), onSuccess: invalidate }),
    reassign: useMutation({ mutationFn: (p: { id: string; ownerId: string }) => dataProvider.exceptions.reassign(p.id, p.ownerId), onSuccess: invalidate }),
    createTask: useMutation({ mutationFn: (id: string) => dataProvider.exceptions.createTaskFromException(id), onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['crm-tasks'] }); } }),
  };
}

export function useCampaigns() {
  return useQuery({ queryKey: ['crm-campaigns'], queryFn: () => dataProvider.campaigns.list() });
}
export function useCampaign(id?: string) {
  return useQuery({ queryKey: ['crm-campaigns', id], queryFn: () => (id ? dataProvider.campaigns.get(id) : Promise.resolve(null)), enabled: !!id });
}
export function useEnrollments(campaignId?: string) {
  return useQuery({ queryKey: ['crm-enrollments', campaignId], queryFn: () => (campaignId ? dataProvider.campaigns.enrollments(campaignId) : Promise.resolve([])), enabled: !!campaignId });
}

export function useStaffList() {
  return useQuery({ queryKey: ['crm-staff'], queryFn: () => dataProvider.staff.list() });
}

export function useClientAudit(clientId?: string) {
  return useQuery({ queryKey: ['crm-audit', clientId], queryFn: () => (clientId ? dataProvider.audit.listForClient(clientId) : Promise.resolve([])), enabled: !!clientId });
}

export function useClientCommunications(clientId?: string) {
  return useQuery({ queryKey: ['crm-comms', clientId], queryFn: () => (clientId ? dataProvider.communications.listForClient(clientId) : Promise.resolve([])), enabled: !!clientId });
}

export function useMessageThreads(channel: 'sms' | 'email') {
  return useQuery({ queryKey: ['crm-comms', 'threads', channel], queryFn: () => dataProvider.communications.listThreads(channel) });
}

export function useReports() {
  return {
    funnel: useQuery({ queryKey: ['report-funnel'], queryFn: () => dataProvider.reports.journeyFunnel() }),
    atRisk: useQuery({ queryKey: ['report-at-risk'], queryFn: () => dataProvider.reports.atRiskMetrics() }),
    engagement: useQuery({ queryKey: ['report-engagement'], queryFn: () => dataProvider.reports.engagementMetrics() }),
    closure: useQuery({ queryKey: ['report-closure'], queryFn: () => dataProvider.reports.closureMetrics() }),
    campaign: useQuery({ queryKey: ['report-campaign'], queryFn: () => dataProvider.reports.campaignPerformance() }),
    task: useQuery({ queryKey: ['report-task'], queryFn: () => dataProvider.reports.taskPerformance() }),
    exception: useQuery({ queryKey: ['report-exception'], queryFn: () => dataProvider.reports.exceptionMetrics() }),
  };
}
