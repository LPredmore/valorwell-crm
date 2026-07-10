import type { PatStatus } from './types';

export type StatusCategory = 'lead' | 'onboarding' | 'active' | 'inactive' | 'closed';

export interface StatusConfig {
  label: string;
  color: string;
  bgColor: string;
  textColor: string;
  order: number;
  category: StatusCategory;
  showInKanban: boolean;
}

export const STATUS_CONFIG: Record<PatStatus, StatusConfig> = {
  'Interested': {
    label: 'Interested',
    color: 'hsl(var(--chart-1))',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    textColor: 'text-blue-700 dark:text-blue-300',
    order: 1,
    category: 'lead',
    showInKanban: true,
  },
  'New': {
    label: 'New',
    color: 'hsl(var(--chart-2))',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    textColor: 'text-purple-700 dark:text-purple-300',
    order: 2,
    category: 'lead',
    showInKanban: true,
  },
  'No Insurance': {
    label: 'No Insurance',
    color: 'hsl(38, 92%, 50%)',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    textColor: 'text-amber-700 dark:text-amber-300',
    order: 3,
    category: 'lead',
    showInKanban: true,
  },
  'Manual Check': {
    label: 'Manual Check',
    color: 'hsl(25, 95%, 53%)',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    textColor: 'text-orange-700 dark:text-orange-300',
    order: 4,
    category: 'lead',
    showInKanban: true,
  },
  'Waitlist': {
    label: 'Waitlist',
    color: 'hsl(var(--chart-3))',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    textColor: 'text-yellow-700 dark:text-yellow-300',
    order: 5,
    category: 'lead',
    showInKanban: true,
  },
  'Matching': {
    label: 'Matching',
    color: 'hsl(var(--chart-4))',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    textColor: 'text-orange-700 dark:text-orange-300',
    order: 6,
    category: 'onboarding',
    showInKanban: true,
  },
  'Registered': {
    label: 'Registered',
    color: 'hsl(173, 58%, 39%)',
    bgColor: 'bg-teal-100 dark:bg-teal-900/30',
    textColor: 'text-teal-700 dark:text-teal-300',
    order: 7,
    category: 'onboarding',
    showInKanban: true,
  },
  'Unscheduled': {
    label: 'Unscheduled',
    color: 'hsl(38, 92%, 50%)',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    textColor: 'text-amber-700 dark:text-amber-300',
    order: 8,
    category: 'onboarding',
    showInKanban: true,
  },
  'Scheduled': {
    label: 'Scheduled',
    color: 'hsl(var(--chart-5))',
    bgColor: 'bg-cyan-100 dark:bg-cyan-900/30',
    textColor: 'text-cyan-700 dark:text-cyan-300',
    order: 9,
    category: 'onboarding',
    showInKanban: true,
  },
  'Early Sessions': {
    label: 'Early Sessions',
    color: 'hsl(142, 71%, 45%)',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-700 dark:text-green-300',
    order: 10,
    category: 'active',
    showInKanban: true,
  },
  'Established': {
    label: 'Established',
    color: 'hsl(160, 84%, 39%)',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    order: 11,
    category: 'active',
    showInKanban: true,
  },
  'Inactive': {
    label: 'Inactive',
    color: 'hsl(0, 0%, 64%)',
    bgColor: 'bg-gray-100 dark:bg-gray-800/50',
    textColor: 'text-gray-500 dark:text-gray-400',
    order: 12,
    category: 'closed',
    showInKanban: true,
  },
  'Blacklisted': {
    label: 'Blacklisted',
    color: 'hsl(0, 72%, 51%)',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    textColor: 'text-red-700 dark:text-red-300',
    order: 13,
    category: 'closed',
    showInKanban: true,
  },
  'DNC': {
    label: 'Do Not Contact',
    color: 'hsl(0, 72%, 51%)',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    textColor: 'text-red-700 dark:text-red-300',
    order: 14,
    category: 'closed',
    showInKanban: true,
  },
  'Unresponsive - Warm': {
    label: 'Unresponsive (Warm)',
    color: 'hsl(25, 95%, 53%)',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    textColor: 'text-orange-700 dark:text-orange-300',
    order: 15,
    category: 'inactive',
    showInKanban: false,
  },
  'Unresponsive - Cold': {
    label: 'Unresponsive (Cold)',
    color: 'hsl(215, 20%, 65%)',
    bgColor: 'bg-slate-100 dark:bg-slate-800/50',
    textColor: 'text-slate-600 dark:text-slate-300',
    order: 16,
    category: 'inactive',
    showInKanban: false,
  },
  'Went Dark (Previously Seen)': {
    label: 'Went Dark',
    color: 'hsl(220, 9%, 46%)',
    bgColor: 'bg-gray-100 dark:bg-gray-800/50',
    textColor: 'text-gray-600 dark:text-gray-300',
    order: 17,
    category: 'inactive',
    showInKanban: false,
  },
  'Not the Right Time': {
    label: 'Not the Right Time',
    color: 'hsl(271, 91%, 65%)',
    bgColor: 'bg-violet-100 dark:bg-violet-900/30',
    textColor: 'text-violet-700 dark:text-violet-300',
    order: 18,
    category: 'closed',
    showInKanban: false,
  },
  'Found Somewhere Else': {
    label: 'Found Elsewhere',
    color: 'hsl(210, 40%, 96%)',
    bgColor: 'bg-slate-100 dark:bg-slate-800/50',
    textColor: 'text-slate-600 dark:text-slate-300',
    order: 19,
    category: 'closed',
    showInKanban: false,
  },
  'At Risk': {
    label: 'At Risk',
    color: 'hsl(25, 95%, 53%)',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    textColor: 'text-orange-700 dark:text-orange-300',
    order: 20,
    category: 'inactive',
    showInKanban: false,
  },
  'Legacy - Has Therapist Available': {
    label: 'Legacy – Has Therapist',
    color: 'hsl(220, 9%, 46%)',
    bgColor: 'bg-gray-100 dark:bg-gray-800/50',
    textColor: 'text-gray-500 dark:text-gray-400',
    order: 21,
    category: 'closed',
    showInKanban: false,
  },
  'Legacy - No Therapist Available': {
    label: 'Legacy – No Therapist',
    color: 'hsl(220, 9%, 46%)',
    bgColor: 'bg-gray-100 dark:bg-gray-800/50',
    textColor: 'text-gray-500 dark:text-gray-400',
    order: 22,
    category: 'closed',
    showInKanban: false,
  },
};

export const KANBAN_STATUSES = Object.entries(STATUS_CONFIG)
  .filter(([_, config]) => config.showInKanban)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([status]) => status as PatStatus);

export const ALL_STATUSES = Object.keys(STATUS_CONFIG) as PatStatus[];

export function getStatusConfig(status: PatStatus | null): StatusConfig {
  if (!status || !STATUS_CONFIG[status]) {
    return STATUS_CONFIG['New'];
  }
  return STATUS_CONFIG[status];
}

export function getClientDisplayName(client: {
  pat_name_preferred?: string | null;
  pat_name_f?: string | null;
  pat_name_l?: string | null;
}): string {
  const parts = [client.pat_name_f, client.pat_name_l].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Unknown Client';
}

export function getTherapistDisplayName(staff: {
  prov_name_for_clients?: string | null;
  prov_name_f?: string | null;
  prov_name_l?: string | null;
} | null | undefined): string {
  if (!staff) return 'Unassigned';
  if (staff.prov_name_for_clients) {
    return staff.prov_name_for_clients;
  }
  const parts = [staff.prov_name_f, staff.prov_name_l].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Unassigned';
}
