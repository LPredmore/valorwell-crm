import { supabase } from '@/integrations/supabase/client';
import { authorizedCrmTenantIds } from '@/domain/auth/crm-auth-navigation';

export type CrmOperatorScope = { tenantId: string; userId: string };

/** A selected tenant is a preference; revalidate it against the current server
 * capability response before each operation. RLS remains authoritative.
 */
export async function requireCrmOperatorScope(scope: CrmOperatorScope) {
  const { data, error } = await supabase.rpc('get_crm_operating_context');
  if (error) throw new Error(error.message);
  if (!authorizedCrmTenantIds(data, scope.userId).includes(scope.tenantId)) {
    throw new Error('Select an authorized CRM workspace for the current session.');
  }
  // The parser above has already validated this server-supplied shape.
  const context = data as { available_tenants: Array<{ tenant_id: string; crm_role: string }> };
  const role = context.available_tenants.find(tenant => tenant.tenant_id === scope.tenantId)!.crm_role;
  return { ...scope, canMutate: role === 'crm_admin' || role === 'crm_operator' };
}
