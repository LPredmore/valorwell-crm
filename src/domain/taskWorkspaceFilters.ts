import { TASK_STATUSES, type TaskPriority, type TaskStatus } from './operations';
import { isTaskView, type TaskView } from './taskViews';
export const TASK_PRIORITIES: TaskPriority[] = ['Low', 'Normal', 'High', 'Urgent'];
export function readTaskWorkspaceFilters(params: URLSearchParams) {
  const rawPage = Number(params.get('page'));
  const rawStatus = params.get('status');
  const rawPriority = params.get('priority');
  const owner = params.get('owner') ?? '';
  return {
    view: (isTaskView(params.get('view')) ? params.get('view') : 'overdue') as TaskView,
    page: Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 1000000 ? rawPage : 1,
    status: TASK_STATUSES.includes(rawStatus as TaskStatus) ? rawStatus as TaskStatus : undefined,
    priority: TASK_PRIORITIES.includes(rawPriority as TaskPriority) ? rawPriority as TaskPriority : undefined,
    owner: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner) ? owner : '',
    search: (params.get('q') ?? '').slice(0, 200),
  };
}
export function taskPageRange(page?: number, pageSize?: number): [number, number] | null {
  if (page === undefined && pageSize === undefined) return null;
  const size = pageSize ?? 50;
  const number = page ?? 1;
  if (!Number.isSafeInteger(number) || number < 1 || number > 1000000
    || !Number.isSafeInteger(size) || size < 1 || size > 100) throw new Error('Invalid task page.');
  const from = (number - 1) * size;
  return [from, from + size - 1];
}
