import { supabase } from '@/integrations/supabase/client';
import { authorizedCrmTenantIds } from '@/domain/auth/crm-auth-navigation';
import type { CrmOperatorScope } from './crmOperatorScope';

// A UI selection, never an authorization grant. Kept in memory so edits to
// browser storage cannot change the tenant underneath an open workspace.
let binding: { mounted: boolean; revision: number; scope: CrmOperatorScope | null } = { mounted: false, revision: 0, scope: null };
export function bindSelectedCrmScope(scope: CrmOperatorScope | null) {
  if (binding.mounted && binding.scope?.tenantId === scope?.tenantId && binding.scope?.userId === scope?.userId) return;
  binding = { mounted: true, revision: binding.revision + 1, scope };
}
export function unbindSelectedCrmScope() {
  binding = { mounted: false, revision: binding.revision + 1, scope: null };
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

/** For direct, explicitly tenant-filtered relationship adapters only. Do not
 * use this to normalize old tenant-implicit campaign/delivery RPC contracts.
 */
export async function selectedRelationshipContext() {
  const captured = binding;
  if (captured.mounted && !captured.scope) throw new Error('No operating tenant is selected for this CRM session.');
  const { data, error } = await supabase.rpc('get_crm_operating_context');
  if (error) throw new Error(error.message);
  if (binding.revision !== captured.revision) throw new Error('CRM session or selected tenant changed. Reload this workspace.');
  if (!object(data) || data.authenticated !== true || typeof data.profile_id !== 'string') throw new Error('Authenticated CRM profile access is required.');
  if (captured.scope) {
    if (!authorizedCrmTenantIds(data, captured.scope.userId).includes(captured.scope.tenantId)) throw new Error('Selected CRM tenant is not authorized for the current session.');
    const available = data.available_tenants as Array<{ tenant_id: string; crm_role: string }>;
    const role = available.find(tenant => tenant.tenant_id === captured.scope!.tenantId)!.crm_role;
    return { tenantId: captured.scope.tenantId, profileId: data.profile_id, crmRole: role,
      canMutate: role === 'crm_admin' || role === 'crm_operator' };
  }
  // Non-UI callers retain the old server-selected contract; never select the
  // first available tenant or infer an identity from user metadata/storage.
  if (typeof data.current_tenant_id !== 'string' || !data.current_tenant_id) throw new Error('No operating tenant is selected for this CRM session.');
  return { tenantId: data.current_tenant_id, profileId: data.profile_id,
    crmRole: typeof data.crm_role === 'string' ? data.crm_role : 'crm_none',
    canMutate: object(data.capabilities) && data.capabilities.mutate === true };
}
