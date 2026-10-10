import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
 getRecruitmentTimeline,logRecruitmentContact,
 type RecruitmentChannel,type RecruitmentDirection,type RecruitmentOutcome,
 type RecruitmentStage,
} from '@/repositories/supabase/recruitment-communications';
import type {ReviewedProspect} from '@/repositories/supabase/recruitment-review';

const STAGES:ReadonlyArray<{value:RecruitmentStage;label:string}>=[
 {value:'not_contacted',label:'Not yet contacted'},
 {value:'contact_attempted',label:'Contact attempted'},
 {value:'replied',label:'Responded'},
 {value:'interested',label:'Interested'},
 {value:'application_handoff',label:'Application handoff discussed'},
 {value:'applicant_linked',label:'Existing application linked'},
 {value:'closed',label:'Closed / no further contact'},
];
const SOURCES:Record<string,string>={
 crm_change:'CRM update',manual_activity:'Recruiter-logged activity',
 relationship_email:'Matched stored CRM email',applicant_email:'Linked applicant email',
 applicant_activity:'Linked applicant activity',
};
export function RecruitmentCommunicationsPanel({tenantId,row,canEdit}:{
 tenantId:string;row:ReviewedProspect;canEdit:boolean;
}){
 const clientActionId=useRef<string|null>(null);
 const qc=useQueryClient();
 const [channel,setChannel]=useState<RecruitmentChannel>('phone');
 const [direction,setDirection]=useState<RecruitmentDirection>('outbound');
 const [outcome,setOutcome]=useState<RecruitmentOutcome>('attempted');
 const [stage,setStage]=useState<RecruitmentStage>(row.recruitingStage??'not_contacted');
 const [summary,setSummary]=useState('');
 useEffect(()=>{
  setStage(row.recruitingStage??'not_contacted');
  clientActionId.current=null;
 },[row.id,row.recruitingStage]);
 const timeline=useQuery({
  queryKey:['recruitment-communication-timeline',tenantId,row.id],
  queryFn:()=>getRecruitmentTimeline(tenantId,row.id),retry:false,
 });
 const record=useMutation({
  mutationFn:()=>logRecruitmentContact({
   tenantId,prospectId:row.id,expectedVersion:row.version,
   channel,direction,outcome,summary,newStage:stage,
   clientActionId:clientActionId.current??(clientActionId.current=crypto.randomUUID()),
  }),
  onSuccess:async()=>{
   setSummary('');clientActionId.current=null;
   await Promise.all([
    qc.invalidateQueries({queryKey:['recruitment-communication-timeline',tenantId,row.id]}),
    qc.invalidateQueries({queryKey:['therapist-prospect-review']}),
    qc.invalidateQueries({queryKey:['therapist-prospect-history',tenantId,row.id]}),
    qc.invalidateQueries({queryKey:['recruitment-campaign-preview']}),
    qc.invalidateQueries({queryKey:['pipeline-connected-cards']}),
   ]);
  },
 });
 const canRecord=canEdit&&summary.trim().length>=3&&
  (stage!=='application_handoff'||outcome==='handoff')&&
  stage!=='applicant_linked';
 return <div className="space-y-4">
  <Card><CardHeader><CardTitle>Recruitment communications timeline</CardTitle>
   <CardDescription>Verified CRM messages, linked applicant activity, and manually logged conversations.
    No emails or texts are sent from this view. Stored messages are shown only when the identity can be matched safely.</CardDescription>
  </CardHeader><CardContent className="space-y-3">
   <p className="text-sm"><strong>Recruitment progress:</strong> {STAGES.find(s=>s.value===(row.recruitingStage??'not_contacted'))?.label??'Not contacted'}</p>
   {timeline.isLoading&&<p role="status">Loading recorded communications…</p>}
   {timeline.isError&&<p role="alert" className="text-destructive">{timeline.error.message}</p>}
   {timeline.data?.length===0&&<p className="text-sm text-muted-foreground">No matched communication events have been recorded yet. Record an actual contact below to build the history; existing historical emails cannot be assigned by name alone.</p>}
   <div className="max-h-[540px] space-y-3 overflow-y-auto">
    {timeline.data?.map(e=><div className="rounded-md border p-3 text-sm space-y-1" key={e.source+':'+e.id}>
     <div className="flex flex-wrap justify-between gap-2">
      <strong>{SOURCES[e.source]??e.source}</strong>
      <span className="text-muted-foreground">{e.at?new Date(e.at).toLocaleString():'Time unavailable'}</span>
     </div>
     <p>{e.subject}</p>
     <p className="text-muted-foreground">{e.channel} · {e.direction} · {e.status}</p>
     {e.summary&&<p className="whitespace-pre-wrap break-words">{e.summary}</p>}
    </div>)}
   </div>
  </CardContent></Card>
  {canEdit&&<Card><CardHeader><CardTitle>Log a contact or next-stage decision</CardTitle>
   <CardDescription>This records an event that has already happened. It does not call, message, invite, or enroll anyone. Select the actual channel and record only accurate outcomes.</CardDescription>
  </CardHeader><CardContent className="space-y-3">
   <div className="grid gap-3 sm:grid-cols-2">
    <div className="space-y-1"><Label htmlFor="activity-channel">Channel</Label>
     <select id="activity-channel" className="w-full rounded border bg-background p-2" value={channel} onChange={e=>setChannel(e.target.value as RecruitmentChannel)}>
      <option value="phone">Phone</option><option value="email">Email</option><option value="sms">SMS</option><option value="linkedin">LinkedIn</option><option value="meeting">Meeting</option><option value="other">Other</option><option value="internal">Internal note</option>
     </select></div>
    <div className="space-y-1"><Label htmlFor="activity-direction">Direction</Label>
     <select id="activity-direction" className="w-full rounded border bg-background p-2" value={direction} onChange={e=>setDirection(e.target.value as RecruitmentDirection)}>
      <option value="outbound">Outgoing (already occurred)</option><option value="inbound">Incoming</option><option value="internal">Internal only</option>
     </select></div>
    <div className="space-y-1"><Label htmlFor="activity-outcome">Recorded outcome</Label>
     <select id="activity-outcome" className="w-full rounded border bg-background p-2" value={outcome} onChange={e=>setOutcome(e.target.value as RecruitmentOutcome)}>
      <option value="attempted">Attempted</option><option value="responded">Response received</option>
      <option value="interested">Expressed interest</option><option value="not_interested">Not interested</option>
      <option value="handoff">Application handoff discussed</option><option value="note">Internal note</option>
     </select></div>
    <div className="space-y-1"><Label htmlFor="activity-stage">Recruitment progress after this event</Label>
     <select id="activity-stage" className="w-full rounded border bg-background p-2" value={stage} onChange={e=>setStage(e.target.value as RecruitmentStage)}>
      {STAGES.filter(x=>x.value!=='applicant_linked').map(s=><option value={s.value} key={s.value}>{s.label}</option>)}
      {stage==='applicant_linked'&&<option value="applicant_linked">Existing application linked</option>}
     </select></div>
   </div>
   <div className="space-y-1"><Label htmlFor="activity-summary">What happened? (required)</Label>
    <Input id="activity-summary" value={summary} maxLength={3000} placeholder="Example: Spoke by phone; clinician requested application information" onChange={e=>{setSummary(e.target.value);clientActionId.current=null;}}/>
   </div>
   {stage==='application_handoff'&&outcome!=='handoff'&&<p className="text-sm text-destructive">Select “Application handoff discussed” as the recorded outcome.</p>}
   {stage==='applicant_linked'&&<p className="text-sm text-muted-foreground">Linked-applicant status is set automatically after you verify and link an existing application below.</p>}
   {record.isError&&<p role="alert" className="text-destructive">{record.error.message} Refresh before retrying if the record was changed by someone else.</p>}
   {record.isSuccess&&<p role="status" className="text-sm">Contact activity recorded. No message sent.</p>}
   <Button disabled={!canRecord||record.isPending} onClick={()=>record.mutate()}>
    {record.isPending?'Recording…':'Record activity (no sending)'}
   </Button>
  </CardContent></Card>}
 </div>;
}
