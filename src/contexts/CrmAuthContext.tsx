import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {
  CrmAuthContext as CrmAuthContextType,
  CrmAvailableTenant,
  CrmCapabilities,
  CrmCapabilityRole,
} from '@/lib/crm/types';
import { CrmAuthCtx } from '@/contexts/crmAuthContextValue';

const CONTRACT_VERSION = 'valorwell-crm-contracts@1.0.1+20260714';
const TENANT_STORAGE_KEY = 'crm.currentTenantId';

const EMPTY_CAPABILITIES: CrmCapabilities = {
  mutate: false,
  communicate: false,
  manage_campaigns: false,
  report: false,
};

function toLegacyRole(crmRole: CrmCapabilityRole): 'admin' | 'staff' {
  return crmRole === 'crm_admin' ? 'admin' : 'staff';
}

interface RpcContext {
  authenticated: boolean;
  profile_id: string | null;
  current_tenant_id: string | null;
  available_tenants: CrmAvailableTenant[];
  crm_role: CrmCapabilityRole;
  capabilities: CrmCapabilities;
  contract_version: string;
}

async function loadOperatingContext(): Promise<RpcContext | null> {
  const { data, error } = await supabase.rpc(
    'get_crm_operating_context' as never,
  );
  if (error) {
    console.error('get_crm_operating_context failed:', error);
    return null;
  }
  return data as unknown as RpcContext;
}

export function CrmAuthProvider({ children }: { children: ReactNode }) {
  const desiredTenantRef = useRef<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem(TENANT_STORAGE_KEY) : null,
  );

  const buildFailClosed = useCallback(
    (over: Partial<CrmAuthContextType> = {}): CrmAuthContextType => ({
      userId: '',
      tenantId: '',
      currentTenantId: null,
      availableTenants: [],
      crmRole: 'crm_none',
      role: 'staff',
      capabilities: EMPTY_CAPABILITIES,
      contractVersion: CONTRACT_VERSION,
      isLoading: false,
      isAuthenticated: false,
      needsTenantSelection: false,
      switchTenant: async () => {},
      refresh: async () => {},
      ...over,
    }),
    [],
  );

  const [authState, setAuthState] = useState<CrmAuthContextType>(() =>
    buildFailClosed({ isLoading: true }),
  );

  const applyContext = useCallback((ctx: RpcContext | null) => {
    if (!ctx || !ctx.authenticated || !ctx.profile_id) {
      setAuthState(buildFailClosed());
      return;
    }

    const available = ctx.available_tenants ?? [];
    let currentTenantId = ctx.current_tenant_id;
    let currentRole = ctx.crm_role;
    let capabilities = ctx.capabilities ?? EMPTY_CAPABILITIES;

    // If server didn't pick (multi-tenant), honor stored preference when valid.
    if (!currentTenantId && desiredTenantRef.current) {
      const match = available.find(
        (t) => t.tenant_id === desiredTenantRef.current,
      );
      if (match) {
        currentTenantId = match.tenant_id;
        currentRole = match.crm_role;
        capabilities =
          match.crm_role === 'crm_admin' || match.crm_role === 'crm_operator'
            ? { mutate: true, communicate: true, manage_campaigns: true, report: true }
            : match.crm_role === 'crm_readonly'
              ? { mutate: false, communicate: false, manage_campaigns: false, report: true }
              : EMPTY_CAPABILITIES;
      }
    }

    const authorized = currentTenantId != null && currentRole !== 'crm_none';

    setAuthState({
      userId: ctx.profile_id,
      tenantId: currentTenantId ?? '',
      currentTenantId,
      availableTenants: available,
      crmRole: currentRole,
      role: toLegacyRole(currentRole),
      capabilities,
      contractVersion: ctx.contract_version ?? CONTRACT_VERSION,
      isLoading: false,
      isAuthenticated: authorized,
      needsTenantSelection: !currentTenantId && available.length > 1,
      switchTenant: async () => {},
      refresh: async () => {},
    });
  }, [buildFailClosed]);

  const refresh = useCallback(async () => {
    const ctx = await loadOperatingContext();
    applyContext(ctx);
  }, [applyContext]);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      const { data, error } = await supabase.rpc(
        'crm_select_operating_tenant' as never,
        { p_tenant_id: tenantId } as never,
      );
      if (error) {
        console.error('crm_select_operating_tenant failed:', error);
        return;
      }
      const result = data as unknown as { ok?: boolean };
      if (!result?.ok) return;
      desiredTenantRef.current = tenantId;
      if (typeof window !== 'undefined') {
        localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
      }
      await refresh();
    },
    [refresh],
  );

  // Rebind stable refresh/switch into every emitted state
  useEffect(() => {
    setAuthState((s) => ({ ...s, refresh, switchTenant }));
  }, [refresh, switchTenant]);

  useEffect(() => {
    refresh();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  return (
    <CrmAuthCtx.Provider value={authState}>
      {children}
    </CrmAuthCtx.Provider>
  );
}
