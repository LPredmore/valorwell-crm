export type CrmPasswordFlow = 'invite' | 'recovery';
const roles = ['crm_admin', 'crm_operator', 'crm_readonly'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function crmPasswordFlow(search: string, hash: string): CrmPasswordFlow | null {
  const flow = new URLSearchParams(search).get('flow') ?? new URLSearchParams(hash.replace(/^#/, '')).get('type');
  return flow === 'invite' || flow === 'recovery' ? flow : null;
}
/** Only the server capability response can supply authorized tenant choices. */
export function authorizedCrmTenantIds(data: unknown, userId: string): string[] {
  if (!object(data) || data.authenticated !== true || data.profile_id !== userId || !Array.isArray(data.available_tenants)) return [];
  return [...new Set(data.available_tenants.flatMap(item => object(item)
    && typeof item.tenant_id === 'string' && uuid.test(item.tenant_id)
    && roles.includes(String(item.crm_role)) ? [item.tenant_id] : []))];
}
export function crmAuthReturnUrl(origin: string, flow?: CrmPasswordFlow): string {
  const url = new URL('/auth', origin);
  if (flow) url.searchParams.set('flow', flow);
  return url.toString();
}
