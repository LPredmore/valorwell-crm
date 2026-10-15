/** Staff PR #30 adds URL search and exact-ID marking within its authorized results.
 * This is a locator, not an exact-record API, permission grant or source action.
 */
export function applicantWorkspaceLink(id: string, name: string): string {
  const url = new URL('https://emr.valorwell.org/staff/provider-applicants');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return url.toString();
  url.searchParams.set('applicant', id);
  if (name.trim()) url.searchParams.set('q', name.trim().slice(0, 200));
  url.searchParams.set('source', 'crm');
  return url.toString();
}
