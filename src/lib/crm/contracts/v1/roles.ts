// Role capability matrix — v1

export type CanonicalRole =
  | 'crm_admin'
  | 'crm_staff_operator'
  | 'campaign_worker_service'
  | 'reporting_only';

export interface RoleCapability {
  role: CanonicalRole;
  action: string;
  read_scope: 'tenant' | 'self';
  mutation_scope: 'tenant' | 'none';
  reason_required: boolean;
  approval_required: boolean;
  audit_required: boolean;
}

// CRM UI maps DB roles onto canonical roles. Only admin/staff exist today.
export function toCanonicalRole(role: 'admin' | 'staff'): CanonicalRole {
  return role === 'admin' ? 'crm_admin' : 'crm_staff_operator';
}
