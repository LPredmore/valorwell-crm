import { supabase } from '@/integrations/supabase/client';
import type { StaffRepository } from '../types';
import type { StaffMember } from '@/domain/operations';

const STAFF_SELECT = `
  id, tenant_id, profile_id,
  prov_name_f, prov_name_m, prov_name_l, prov_name_for_clients,
  prov_phone, prov_state, prov_status, prov_accepting_new_clients,
  prov_max_clients
`;

type Row = Record<string, string | number | null>;

function mapRole(role: string | undefined): StaffMember['role'] {
  if (role === 'admin') return 'admin';
  if (role === 'clinician') return 'clinician';
  if (role === 'operations') return 'operations';
  return 'staff';
}

function mapStatus(s: string | null | undefined): StaffMember['status'] {
  if (!s) return 'Active';
  const v = s.toLowerCase();
  if (v.includes('leave')) return 'On Leave';
  if (v.includes('inactive') || v.includes('terminated') || v.includes('disabled')) return 'Inactive';
  return 'Active';
}

async function buildStaff(rows: Row[]): Promise<StaffMember[]> {
  if (!rows.length) return [];
  const profileIds = Array.from(new Set(rows.map((r) => r.profile_id).filter(Boolean)));
  const staffIds = rows.map((r) => r.id);

  const [profilesRes, rolesRes, caseloadRes, tasksRes] = await Promise.all([
    supabase.from('profiles').select('id, email').in('id', profileIds),
    supabase.from('user_roles').select('user_id, role').in('user_id', profileIds),
    supabase.from('clients').select('primary_staff_id').in('primary_staff_id', staffIds),
    supabase
      .from('crm_tasks')
      .select('staff_id, status')
      .in('staff_id', staffIds)
      .not('status', 'in', '(completed,canceled)'),
  ]);

  const emailByProfile = new Map<string, string>(
    (profilesRes.data ?? []).map((p) => [p.id, p.email]),
  );
  const roleByProfile = new Map<string, string>();
  for (const r of rolesRes.data ?? []) {
    // prefer higher-privilege roles
    const existing = roleByProfile.get(r.user_id);
    const next = r.role as string;
    if (!existing || next === 'admin') roleByProfile.set(r.user_id, next);
  }
  const caseload = new Map<string, number>();
  for (const c of caseloadRes.data ?? []) {
    if (!c.primary_staff_id) continue;
    caseload.set(c.primary_staff_id, (caseload.get(c.primary_staff_id) ?? 0) + 1);
  }
  const openTasks = new Map<string, number>();
  for (const t of tasksRes.data ?? []) {
    if (!t.staff_id) continue;
    openTasks.set(t.staff_id, (openTasks.get(t.staff_id) ?? 0) + 1);
  }

  return rows.map((r) => {
    const first = r.prov_name_f ?? '';
    const last = r.prov_name_l ?? '';
    const display = r.prov_name_for_clients?.trim() || `${first} ${last}`.trim() || 'Unnamed';
    const role = mapRole(r.profile_id ? roleByProfile.get(r.profile_id) : undefined);
    const cl = caseload.get(r.id) ?? 0;
    const cap = typeof r.prov_max_clients === 'number' ? r.prov_max_clients : undefined;
    let availability: StaffMember['availability'] = 'Available';
    if (r.prov_accepting_new_clients === false) availability = 'Unavailable';
    else if (cap && cl >= cap) availability = 'Full';
    return {
      id: r.id,
      tenantId: r.tenant_id,
      firstName: first,
      lastName: last,
      displayName: display,
      role,
      status: mapStatus(r.prov_status),
      states: r.prov_state ? [r.prov_state] : [],
      email: (r.profile_id && emailByProfile.get(r.profile_id)) || '',
      phone: r.prov_phone ?? undefined,
      caseloadCount: cl,
      openTaskCount: openTasks.get(r.id) ?? 0,
      availability,
      credentialsSummary: undefined,
    } satisfies StaffMember;
  });
}

export const supabaseStaffRepository: StaffRepository = {
  async list() {
    const { data, error } = await supabase
      .from('staff')
      .select(STAFF_SELECT)
      .order('prov_name_l', { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return buildStaff(data ?? []);
  },
  async get(id) {
    const { data, error } = await supabase
      .from('staff')
      .select(STAFF_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const [mapped] = await buildStaff([data]);
    return mapped ?? null;
  },
};
