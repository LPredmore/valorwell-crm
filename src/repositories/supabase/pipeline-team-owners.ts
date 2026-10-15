import {supabase} from '@/integrations/supabase/client';

type TeamOwner={id:string;name:string};
export async function listTeamOwners(tenantId:string):Promise<TeamOwner[]>{
  const people=new Map<string,TeamOwner>();
  const size=200;
  for(let offset=0;;offset+=size){
    const {data,error}=await supabase.from('staff').select('id,profile_id,prov_name_f,prov_name_l,prov_status')
      .eq('tenant_id',tenantId).not('profile_id','is',null).order('id',{ascending:true}).range(offset,offset+size-1);
    if(error)throw new Error(error.message);
    const rows=data??[];
    for(const row of rows){
      if(!row.profile_id||row.prov_status==='Inactive')continue;
      const name=[row.prov_name_f,row.prov_name_l].filter(Boolean).join(' ').trim();
      people.set(row.profile_id,{id:row.profile_id,name:name||'Team member'});
    }
    if(rows.length<size)break;
  }
  return [...people.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
