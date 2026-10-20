import { supabase } from '@/integrations/supabase/client';
import type { ApplicantHandoff } from '@/domain/pipelines/applicant-handoff';

export const applicantStatuses = ['new', 'contacted', 'screening', 'application', 'credentialing', 'ready', 'hired', 'declined', 'withdrawn', 'no_response', 'inactive'] as const;
export type ApplicantHandoffRow = ApplicantHandoff & {
  id: string; name: string; status: string; nextAction: string | null; nextActionDueAt: string | null;
  applicantOrigin: string | null; source: string | null; referralSource: string | null;
  email: string | null; phone: string | null; primaryState: string | null; licenseType: string | null;
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
      applicantOrigin: nullableText(value.applicantOrigin), source: nullableText(value.source),
      referralSource: nullableText(value.referralSource),
      email: nullableText(value.email), phone: nullableText(value.phone),
      primaryState: nullableText(value.primaryState), licenseType: nullableText(value.licenseType),
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

/** Traverse the authorized paged contract before applying a client-side origin filter. */
export async function listAllApplicantHandoffs(tenantId: string, status: string, search: string) {
  const items: ApplicantHandoffRow[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 1000; page++) {
    const response = await listApplicantHandoffs(tenantId, page, status, search);
    for (const row of response.items) {
      if (!seen.has(row.id)) { items.push(row); seen.add(row.id); }
    }
    if (items.length >= response.total) return { items, total: response.total };
    if (response.items.length === 0) throw new Error('Applicant pagination stopped before all authorized records were returned.');
  }
  throw new Error('Applicant directory exceeds the supported pagination limit.');
}

export type ApplicantProfessionalDetails = {
  summary: string | null; verificationNeeded: string[];
  credentialVerificationStatus: string | null; indeedConversationEmail: string | null;
  reportedLicenseType: string | null; reportedLicensedStates: string[];
  licenseStatesToVerify: string[]; licenseStateEvidence: string | null;
  clinicalHighlights: string[];
};

/** Tenant-matched, staff-authorized applicant details; never query the protected table directly. */
export async function getApplicantProfessionalDetails(tenantId: string, applicantId: string): Promise<ApplicantProfessionalDetails | null> {
  const { data, error } = await supabase.rpc('staff_get_provider_applicant', {
    p_tenant_id: tenantId, p_applicant_id: applicantId,
  });
  if (error) throw new Error(error.message);
  if (!object(data) || !object(data.applicant)) return null;
  const review = data.applicant.resumeReview;
  if (!object(review)) return null;
  const flags = review.verificationNeeded;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  return {
    summary: nullableText(review.summary),
    verificationNeeded: strings(flags),
    credentialVerificationStatus: nullableText(review.credentialVerificationStatus),
    indeedConversationEmail: nullableText(review.indeedConversationEmail),
    reportedLicenseType: nullableText(review.reportedLicenseType),
    reportedLicensedStates: strings(review.reportedLicensedStates),
    licenseStatesToVerify: strings(review.licenseStatesToVerify),
    licenseStateEvidence: nullableText(review.licenseStateEvidence),
    clinicalHighlights: strings(review.clinicalHighlights),
  };
}
