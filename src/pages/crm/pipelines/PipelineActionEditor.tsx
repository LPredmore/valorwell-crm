import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {CrmPipelineRecord} from '@/domain/pipelines/models';
import {pipelinesRepository} from '@/repositories/supabase/pipelines';
import {listTeamOwners} from '@/repositories/supabase/pipeline-team-owners';

function localDatetime(iso:string|null){
  if(!iso)return '';
  const d=new Date(iso);
  if(!Number.isFinite(d.getTime()))return '';
  const pad=(v:number)=>String(v).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function PipelineActionEditor({record,userId,busy,save}:{
  record:CrmPipelineRecord;userId:string;busy:boolean;
  save:(fn:()=>Promise<unknown>)=>void;
}){
  const [open,setOpen]=useState(false);
  const [action,setAction]=useState(record.next_action??'');
  const [due,setDue]=useState(localDatetime(record.next_action_due_at));
  const [owner,setOwner]=useState('keep');
  const team=useQuery({queryKey:['crm-pipeline-team-owners',record.tenant_id],
    queryFn:()=>listTeamOwners(record.tenant_id),enabled:open,retry:false});
  const dueValid=!due||Number.isFinite(new Date(due).getTime());
  return <div className="space-y-2">
    <Button size="sm" variant="outline" disabled={busy} onClick={()=>setOpen(x=>!x)}>
      {open?'Hide follow-up':'Edit owner / next action'}
    </Button>
    {open&&<div className="space-y-2 rounded border p-2">
      <label className="block space-y-1 text-xs">Next action
        <Input maxLength={500} value={action} onChange={e=>setAction(e.target.value)} placeholder="Next step"/>
      </label>
      <label className="block space-y-1 text-xs">Due date and time
        <Input type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/>
      </label>
      <label className="block space-y-1 text-xs">Owner
        <select className="w-full rounded border bg-background p-2" value={owner}
          onChange={e=>setOwner(e.target.value)}>
          <option value="keep">{record.owner_profile_id?'Keep existing owner':'Unassigned (no change)'}</option>
          <option value="me">Assign to me</option><option value="none">Unassign</option>
          {(team.data??[]).filter(member=>member.id!==userId).map(member=><option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
      </label>
      {team.isError&&<p role="alert" className="text-destructive text-xs">Team directory unavailable; you can still assign to yourself or unassign.</p>}
      <Button size="sm" disabled={busy||!dueValid||!userId}
        onClick={()=>save(async()=>{
          await pipelinesRepository.updateWorkflow(record,{
            owner_profile_id:owner==='me'?userId:owner==='none'?null:owner==='keep'?record.owner_profile_id:owner,
            next_action:action.trim()||null,
            next_action_due_at:due?new Date(due).toISOString():null,
          });
          setOpen(false);
        })}>Save follow-up</Button>
      {!dueValid&&<p role="alert" className="text-destructive text-xs">Choose a valid date and time.</p>}
    </div>}
  </div>;
}
