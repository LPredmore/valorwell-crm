export const TASK_VIEW_IDS = [
  'my',
  'team',
  'overdue',
  'due-today',
  'due-week',
  'unassigned',
  'client-followups',
  'staff-followups',
  'campaign-exceptions',
  'recently-completed',
  'all',
] as const;

export type TaskView = (typeof TASK_VIEW_IDS)[number];

export interface TaskViewDateBounds {
  timeZone: string;
  dayStartIso: string;
  nextDayStartIso: string;
  weekStartIso: string;
  nextWeekStartIso: string;
}

export function isTaskView(value: string | null | undefined): value is TaskView {
  return typeof value === 'string' && (TASK_VIEW_IDS as readonly string[]).includes(value);
}
