import {supabase} from '@/integrations/supabase/client';

type TeamOwner={id:string;name:string};
export async function listTeamOwners(tenantId:string):Promise<TeamOwner[]>{
  const {data,error}=await supabase.from('staff').select('profile_id,prov_name_f,prov_name_l,prov_status')
    .eq('tenant_id',tenantId).not('profile_id','is',null).limit(500);
  if(error)throw new Error(error.message);
  const people=new Map<string,TeamOwner>();
  for(const row of data??[]){
    if(!row.profile_id||row.prov_status==='Inactive')continue;
    const name=[row.prov_name_f,row.prov_name_l].filter(Boolean).join(' ').trim();
    people.set(row.profile_id,{id:row.profile_id,name:name||'Team member'});
  }
  return [...people.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
