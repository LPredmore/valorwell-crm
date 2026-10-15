import { supabase } from '@/integrations/supabase/client';
import type { ApplicantHandoff } from '@/domain/pipelines/applicant-handoff';

export const applicantStatuses = ['new', 'contacted', 'screening', 'application', 'credentialing', 'ready', 'hired', 'declined', 'withdrawn', 'no_response', 'inactive'] as const;
export type ApplicantHandoffRow = ApplicantHandoff & {
  id: string; name: string; status: string; nextAction: string | null; nextActionDueAt: string | null;
};
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error('Unsupported applicant handoff response.');
  return value;
}
export function parseApplicantHandoffPage(data: unknown, page: number) {
  if (!object(data) || !Array.isArray(data.items) || data.page !== page || data.pageSize !== 50
    || typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0) {
    throw new Error('Applicant handoff data is unavailable: unsupported staff contract.');
  }
  const items: ApplicantHandoffRow[] = data.items.map(value => {
    if (!object(value) || typeof value.id !== 'string' || typeof value.status !== 'string'
      || !applicantStatuses.includes(value.status as typeof applicantStatuses[number])) {
      throw new Error('Unsupported applicant handoff response.');
    }
    return {
      id: value.id, name: [nullableText(value.firstName), nullableText(value.lastName)].filter(Boolean).join(' ') || 'Unnamed applicant',
      status: value.status, ownerName: nullableText(value.ownerName),
      convertedStaffId: nullableText(value.convertedStaffId),
      nextAction: nullableText(value.nextAction), nextActionDueAt: nullableText(value.nextActionDueAt),
    };
  });
  return { items, total: Number(data.total) };
}

/** No direct protected-table read and no applicant, staff, contact or message writes. */
export async function listApplicantHandoffs(tenantId: string, page: number, status: string, search: string) {
  if (!tenantId || !Number.isSafeInteger(page) || page < 1 || page > 1000000
    || (status !== 'all' && !applicantStatuses.includes(status as typeof applicantStatuses[number]))) {
    throw new Error('Invalid applicant handoff filters.');
  }
  const { data: staffTenant, error: scopeError } = await supabase.rpc('crm_staff_tenant_for_applicant_pipeline');
  if (scopeError || staffTenant !== tenantId) throw new Error('The selected CRM tenant requires matching staff applicant access.');
  const { data, error } = await supabase.rpc('staff_list_provider_applicants', {
    p_status: status, p_search: search.trim().slice(0, 200), p_page: page, p_page_size: 50,
  });
  if (error) throw new Error(error.message);
  return parseApplicantHandoffPage(data, page);
}
