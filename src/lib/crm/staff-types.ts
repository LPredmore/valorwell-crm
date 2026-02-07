// Staff management types for CRM

export type StaffStatus = 'Invited' | 'New' | 'Active' | 'Inactive';

export interface CrmStaff {
  id: string;
  tenant_id: string;
  prov_name_f: string | null;
  prov_name_l: string | null;
  prov_name_for_clients: string | null;
  prov_status: StaffStatus | null;
  prov_state: string | null;
  prov_phone: string | null;
  email: string | null; // Joined from profiles
}

export interface StaffFilters {
  statuses: StaffStatus[];
  states: string[];
  search: string;
}

export const STAFF_STATUS_CONFIG: Record<StaffStatus, {
  label: string;
  bgColor: string;
  textColor: string;
}> = {
  'Invited': {
    label: 'Invited',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    textColor: 'text-blue-700 dark:text-blue-300',
  },
  'New': {
    label: 'New',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    textColor: 'text-purple-700 dark:text-purple-300',
  },
  'Active': {
    label: 'Active',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-700 dark:text-green-300',
  },
  'Inactive': {
    label: 'Inactive',
    bgColor: 'bg-gray-100 dark:bg-gray-800/50',
    textColor: 'text-gray-500 dark:text-gray-400',
  },
};

export const DEFAULT_STAFF_FILTERS: StaffFilters = {
  statuses: [],
  states: [],
  search: '',
};
