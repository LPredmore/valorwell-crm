import {useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {CrmPipeline,CrmPipelineStage} from '@/domain/pipelines/models';
import type {ConnectedPipelineCard} from '@/repositories/supabase/connected-pipeline-cards';
import {allowedBtySourceStatuses} from '@/domain/pipelines/bty-source-transitions';
import {transitionBtyPipelineCard} from '@/repositories/supabase/bty-connected-transition';
import {allowedApplicantSourceStatuses} from '@/domain/pipelines/applicant-source-transitions';
import {transitionApplicantPipelineCard} from '@/repositories/supabase/applicant-connected-transition';

export function ConnectedStageEditor({pipeline,card,stages,busy,save}:{
  pipeline:CrmPipeline;card:ConnectedPipelineCard;stages:CrmPipelineStage[];
  busy:boolean;save:(fn:()=>Promise<unknown>)=>void;
}){
  const [open,setOpen]=useState(false);
  const [toStatus,setToStatus]=useState('');
  const [reason,setReason]=useState('');
  const candidates=useMemo(()=>{
    const allowed=pipeline.source_key==='relationship_opportunities'
      ?allowedBtySourceStatuses(card.sourceStatus??'')
      :pipeline.source_key==='provider_applicants'
        ?allowedApplicantSourceStatuses(card.sourceStatus??''):[];
    return stages.filter(stage=>stage.source_stage_key&&allowed.includes(stage.source_stage_key));
  },[pipeline.source_key,card.sourceStatus,stages]);
  if(!['relationship_opportunities','provider_applicants'].includes(pipeline.source_key??'')
    ||card.sourceVersion===undefined)return null;
  const isApplicant=pipeline.source_key==='provider_applicants';
  const applicantReady=!!card.owner_profile_id&&!!card.next_action?.trim()&&!!card.next_action_due_at;
  return <div className="space-y-2">
    <Button size="sm" variant="outline" disabled={busy||candidates.length===0}
      onClick={()=>setOpen(v=>!v)}>{open?'Cancel stage change':isApplicant?'Update applicant stage':'Change BTY stage'}</Button>
    {open&&<div className="rounded border space-y-2 p-2">
      <p className="text-xs text-muted-foreground">
        {isApplicant
          ?'Only Contacted → Screening is allowed here, through the existing staff-authorized update contract. First-contact delivery, approval and onboarding invitations must be handled in the staff applicant workspace. No messages are sent from this control.'
          :'This updates the audited source BTY opportunity. Ready for Campaign is managed through the existing approval workflow because it can trigger campaign enrollment. No contact is automatically treated as delivered by this control.'}
      </p>
      {isApplicant&&!applicantReady&&<p role="status" className="text-xs text-destructive">
        The applicant requires an assigned owner and scheduled next action. Complete those fields in the staff applicant workspace before transitioning.
      </p>}
      <label className="block space-y-1 text-xs">{isApplicant?'New applicant stage':'New BTY stage'}
        <select className="w-full rounded border bg-background p-2"
          value={toStatus} onChange={e=>setToStatus(e.target.value)}>
          <option value="">Choose a permitted transition</option>
          {candidates.map(stage=><option key={stage.id} value={stage.source_stage_key!}>{stage.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-xs">Reason for this status change (recorded in history)
        <Input value={reason} maxLength={500} placeholder="What actually changed?" onChange={e=>setReason(e.target.value)}/>
      </label>
      <Button size="sm" disabled={busy||!toStatus||reason.trim().length<8||(isApplicant&&!applicantReady)}
        onClick={()=>save(async()=>{
          if(isApplicant)await transitionApplicantPipelineCard(pipeline,card,toStatus,reason);
          else await transitionBtyPipelineCard(pipeline,card,toStatus,reason);
          setReason('');setToStatus('');setOpen(false);
        })}>Confirm source stage change</Button>
    </div>}
  </div>;
}
