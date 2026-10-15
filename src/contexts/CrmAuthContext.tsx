import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {
  CrmAuthContext as CrmAuthContextType,
  CrmAvailableTenant,
  CrmCapabilities,
  CrmCapabilityRole,
} from '@/lib/crm/types';
import { authorizedCrmTenantIds } from '@/domain/auth/crm-auth-navigation';
import { CrmAuthCtx } from '@/contexts/crmAuthContextValue';
import { bindSelectedCrmScope, unbindSelectedCrmScope } from '@/repositories/selectedCrmScope';

const CONTRACT_VERSION = 'valorwell-crm-contracts@1.0.1+20260714';
const TENANT_STORAGE_KEY = 'crm.currentTenantId';
function storedTenantPreference() {
  try { return typeof window !== 'undefined' ? window.localStorage.getItem(TENANT_STORAGE_KEY) : null; }
  catch { return null; }
}

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
    storedTenantPreference(),
  );
  const requestVersion = useRef(0);
  const active = useRef(true);

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
    if (!ctx || ctx.authenticated !== true || typeof ctx.profile_id !== 'string' || !ctx.profile_id) {
      bindSelectedCrmScope(null);
      setAuthState(buildFailClosed());
      return;
    }

    const allowed = authorizedCrmTenantIds(ctx, ctx.profile_id);
    const available = Array.isArray(ctx.available_tenants)
      ? ctx.available_tenants.filter(t => t && allowed.includes(t.tenant_id)) : [];
    const serverSelection = available.find(t => t.tenant_id === ctx.current_tenant_id && t.crm_role === ctx.crm_role);
    let currentTenantId = serverSelection?.tenant_id ?? null;
    let currentRole: CrmCapabilityRole = serverSelection?.crm_role ?? 'crm_none';
    let capabilities = serverSelection ? (ctx.capabilities ?? EMPTY_CAPABILITIES) : EMPTY_CAPABILITIES;

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
    bindSelectedCrmScope(authorized ? {tenantId:currentTenantId!,userId:ctx.profile_id} : null);

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
    const version = ++requestVersion.current;
    const ctx = await loadOperatingContext().catch(()=>null);
    if(active.current&&version===requestVersion.current)applyContext(ctx);
  }, [applyContext]);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      const version=++requestVersion.current;
      bindSelectedCrmScope(null);
      setAuthState(buildFailClosed({isLoading:true}));
      const { data, error } = await Promise.resolve(supabase.rpc(
        'crm_select_operating_tenant' as never,
        { p_tenant_id: tenantId } as never,
      )).catch(()=>({data:null,error:{message:'Workspace selection could not be checked.'}}));
      if(!active.current||version!==requestVersion.current)return;
      if (error) {
        console.error('crm_select_operating_tenant failed:', error);
        await refresh();
        return;
      }
      const result = data as unknown as { ok?: boolean };
      if (!result?.ok) {await refresh();return;}
      desiredTenantRef.current = tenantId;
      if (typeof window !== 'undefined') {
        try { window.localStorage.setItem(TENANT_STORAGE_KEY, tenantId); }
        catch { /* Keep the authorized in-memory selection when storage is unavailable. */ }
      }
      await refresh();
    },
    [refresh,buildFailClosed],
  );

  useEffect(() => {
    active.current=true;
    bindSelectedCrmScope(null);
    refresh();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // Hide the previous session immediately; stale context responses cannot
      // repopulate its role/tenant after this newer refresh starts.
      setAuthState(buildFailClosed({isLoading:true}));
      bindSelectedCrmScope(null);
      void refresh();
    });
    return () => {active.current=false;requestVersion.current++;unbindSelectedCrmScope();subscription.unsubscribe();};
  }, [refresh,buildFailClosed]);

  return (
    <CrmAuthCtx.Provider value={{...authState,refresh,switchTenant}}>
      {children}
    </CrmAuthCtx.Provider>
  );
}
