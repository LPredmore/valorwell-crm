import {useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {CrmPipeline,CrmPipelineStage} from '@/domain/pipelines/models';
import type {ConnectedPipelineCard} from '@/repositories/supabase/connected-pipeline-cards';
import {allowedBtySourceStatuses} from '@/domain/pipelines/bty-source-transitions';
import {transitionBtyPipelineCard} from '@/repositories/supabase/bty-connected-transition';

export function ConnectedStageEditor({pipeline,card,stages,busy,save}:{
  pipeline:CrmPipeline;card:ConnectedPipelineCard;stages:CrmPipelineStage[];
  busy:boolean;save:(fn:()=>Promise<unknown>)=>void;
}){
  const [open,setOpen]=useState(false);
  const [toStatus,setToStatus]=useState('');
  const [reason,setReason]=useState('');
  const candidates=useMemo(()=>{
    if(pipeline.source_key!=='relationship_opportunities')return [];
    const allowed=allowedBtySourceStatuses(card.sourceStatus??'');
    return stages.filter(stage=>stage.source_stage_key&&allowed.includes(stage.source_stage_key));
  },[pipeline.source_key,card.sourceStatus,stages]);
  if(pipeline.source_key!=='relationship_opportunities'||card.sourceVersion===undefined)return null;
  return <div className="space-y-2">
    <Button size="sm" variant="outline" disabled={busy||candidates.length===0}
      onClick={()=>setOpen(v=>!v)}>{open?'Cancel stage change':'Change BTY stage'}</Button>
    {open&&<div className="rounded border space-y-2 p-2">
      <p className="text-xs text-muted-foreground">
        This updates the source BTY opportunity and its status history. It does not send outreach or mark a message as delivered.
        Only select a state that actually reflects the organization's progress.
      </p>
      <label className="block space-y-1 text-xs">New BTY stage
        <select className="w-full rounded border bg-background p-2"
          value={toStatus} onChange={e=>setToStatus(e.target.value)}>
          <option value="">Choose a permitted transition</option>
          {candidates.map(stage=><option key={stage.id} value={stage.source_stage_key!}>{stage.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-xs">Reason for this status change (recorded in history)
        <Input value={reason} maxLength={500} placeholder="What actually changed?" onChange={e=>setReason(e.target.value)}/>
      </label>
      <Button size="sm" disabled={busy||!toStatus||reason.trim().length<8}
        onClick={()=>save(async()=>{
          await transitionBtyPipelineCard(pipeline,card,toStatus,reason);
          setReason('');setToStatus('');setOpen(false);
        })}>Confirm source stage change</Button>
    </div>}
  </div>;
}
