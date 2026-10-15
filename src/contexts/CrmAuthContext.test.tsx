import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, authEvents } = vi.hoisted(() => ({ rpc: vi.fn(), authEvents: { listener: undefined as undefined | (()=>void) } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc, auth: { onAuthStateChange: vi.fn((listener:()=>void) => { authEvents.listener=listener;return { data: { subscription: { unsubscribe: vi.fn() } } }; }) },
} }));
import { CrmAuthProvider } from './CrmAuthContext';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
const first='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const context = (tenantId:string|null=first) => ({ authenticated:true,profile_id:'user',current_tenant_id:tenantId,
  crm_role:tenantId?'crm_operator':'crm_none',capabilities:{mutate:true},available_tenants:[
    {tenant_id:first,crm_role:'crm_operator'},{tenant_id:second,crm_role:'crm_readonly'},
  ] });
function Consumer(){const auth=useCrmAuth();return <>
  <p>{auth.isLoading?'Loading':`${auth.currentTenantId??'none'}:${auth.crmRole}`}</p>
  <button onClick={()=>void auth.switchTenant(second)}>Switch</button>
  <button onClick={()=>void auth.refresh()}>Refresh</button>
</>;}
beforeEach(()=>{vi.clearAllMocks();rpc.mockReset();window.localStorage.clear();authEvents.listener=undefined;});
describe('CRM context refresh and workspace selection',()=>{
  it('retains the real switch callback after a context response replaces state',async()=>{
    rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='crm_select_operating_tenant'?{ok:true}:context(),error:null}));
    render(<CrmAuthProvider><Consumer/></CrmAuthProvider>);
    await screen.findByText(`${first}:crm_operator`);
    rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='crm_select_operating_tenant'?{ok:true}:context(null),error:null}));
    fireEvent.click(screen.getByText('Switch'));
    await screen.findByText(`${second}:crm_readonly`);
    expect(rpc).toHaveBeenCalledWith('crm_select_operating_tenant',{p_tenant_id:second});
  });
  it('discards old context responses after an auth event starts a newer refresh',async()=>{
    let resolveOld:(value:unknown)=>void=()=>{};
    rpc.mockReturnValueOnce(new Promise(resolve=>{resolveOld=resolve;}));
    render(<CrmAuthProvider><Consumer/></CrmAuthProvider>);
    rpc.mockResolvedValue({data:{authenticated:false},error:null});
    act(()=>authEvents.listener?.());
    await screen.findByText('none:crm_none');
    await act(async()=>resolveOld({data:context(),error:null}));
    await waitFor(()=>expect(screen.getByText('none:crm_none')).toBeTruthy());
  });
  it('fails closed instead of leaving startup loading after a rejected request',async()=>{
    rpc.mockRejectedValue(new Error('Network unavailable'));
    render(<CrmAuthProvider><Consumer/></CrmAuthProvider>);
    await screen.findByText('none:crm_none');
  });
});
