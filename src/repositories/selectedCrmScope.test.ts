import { afterEach, describe, expect, it, vi } from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
import {bindSelectedCrmScope,selectedRelationshipContext,unbindSelectedCrmScope} from './selectedCrmScope';
const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const server={authenticated:true,profile_id:userId,current_tenant_id:null,available_tenants:[{tenant_id:tenantId,crm_role:'crm_operator'}]};
afterEach(()=>{unbindSelectedCrmScope();vi.resetAllMocks();});
describe('direct relationship selected tenant context',()=>{
  it('uses a selected tenant only when the current server capability set authorizes it',async()=>{
    bindSelectedCrmScope({tenantId,userId});rpc.mockResolvedValue({data:server,error:null});
    await expect(selectedRelationshipContext()).resolves.toMatchObject({tenantId,profileId:userId,canMutate:true});
    rpc.mockResolvedValue({data:{...server,profile_id:'new-user'},error:null});
    await expect(selectedRelationshipContext()).rejects.toThrow(/not authorized/);
  });
  it('does not fall back to a default tenant while mounted selection is unavailable',async()=>{
    bindSelectedCrmScope(null);
    await expect(selectedRelationshipContext()).rejects.toThrow(/No operating tenant/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects a tenant/session switch during the server context request',async()=>{
    bindSelectedCrmScope({tenantId,userId});let finish:(value:unknown)=>void=()=>{};
    rpc.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    const pending=selectedRelationshipContext();bindSelectedCrmScope(null);finish({data:server,error:null});
    await expect(pending).rejects.toThrow(/changed/);
  });
  it('uses server readonly role instead of a stale UI mutation capability',async()=>{
    bindSelectedCrmScope({tenantId,userId});rpc.mockResolvedValue({data:{...server,available_tenants:[{tenant_id:tenantId,crm_role:'crm_readonly'}]},error:null});
    await expect(selectedRelationshipContext()).resolves.toMatchObject({canMutate:false});
  });
});
