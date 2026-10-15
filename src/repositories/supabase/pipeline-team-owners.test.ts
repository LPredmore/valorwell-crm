import { describe, expect, it, vi } from 'vitest';
const { query, from } = vi.hoisted(()=>({from:vi.fn(),query:{select:vi.fn(),eq:vi.fn(),not:vi.fn(),order:vi.fn(),range:vi.fn()}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from}}));
import {listTeamOwners} from './pipeline-team-owners';
describe('complete tenant team owner directory',()=>{
  it('loads past the former 500-record cap and excludes inactive rows without dropping later active staff',async()=>{
    from.mockReturnValue(query);for(const key of ['select','eq','not','order'] as const)query[key].mockReturnValue(query);
    const rows=Array.from({length:601},(_,i)=>({id:String(i),profile_id:'profile-'+i,prov_name_f:'Member',prov_name_l:String(i),prov_status:i<600?'Inactive':'Active'}));
    query.range.mockImplementation((from:number,to:number)=>Promise.resolve({data:rows.slice(from,to+1),error:null}));
    await expect(listTeamOwners('tenant')).resolves.toEqual([{id:'profile-600',name:'Member 600'}]);
    expect(query.range).toHaveBeenCalledWith(600,799);
    expect(query.eq).toHaveBeenCalledWith('tenant_id','tenant');
  });
});
