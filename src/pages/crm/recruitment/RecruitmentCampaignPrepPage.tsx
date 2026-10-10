import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {useCrmAuth} from '@/hooks/crm/useCrmAuth';
import {RecruitmentDeliveryLedgerPanel} from './RecruitmentDeliveryLedgerPanel';
import {
 listRecruitmentDrafts,listRecruitmentReplies,previewRecruitmentDraft,
 reviewRecruitmentReply,saveRecruitmentDraft,
 type RecruitmentDraftStep,type RecruitmentInboundReply,
} from '@/repositories/supabase/recruitment-campaign-prep';

const emptyStep=():RecruitmentDraftStep=>({delayDays:0,subject:'',bodyText:''});
const classifications:Record<string,string>={
 opt_out:'Unsubscribe / do not contact',
 possible_interest:'Possible interest — review',
 possible_decline:'Possible decline — review',
 needs_review:'Needs human review',
};
export default function RecruitmentCampaignPrepPage(){
 const {currentTenantId,capabilities}=useCrmAuth();
 const qc=useQueryClient();
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [name,setName]=useState('');const [description,setDescription]=useState('');
 const [stateFilter,setStateFilter]=useState('');const [licenseFilter,setLicenseFilter]=useState('');
 const [steps,setSteps]=useState<RecruitmentDraftStep[]>([emptyStep()]);
 const drafts=useQuery({
  queryKey:['recruitment-draft-sequences',currentTenantId],
  queryFn:()=>listRecruitmentDrafts(currentTenantId!),enabled:!!currentTenantId,retry:false,
 });
 const replies=useQuery({
  queryKey:['recruitment-inbound-replies',currentTenantId],
  queryFn:()=>listRecruitmentReplies(currentTenantId!),enabled:!!currentTenantId,retry:false,
 });
 const preview=useQuery({
  queryKey:['recruitment-sequence-preview',currentTenantId,selectedId],
  queryFn:()=>previewRecruitmentDraft(currentTenantId!,selectedId!),
  enabled:!!currentTenantId&&!!selectedId,retry:false,
 });
 useEffect(()=>{
  const selected=drafts.data?.find(d=>d.id===selectedId);
  if(!selected)return;
  setName(selected.name);setDescription(selected.description??'');
  setStateFilter(selected.stateFilter??'');setLicenseFilter(selected.licenseFilter??'');
  setSteps(selected.steps.length?selected.steps.map(x=>({...x})):[emptyStep()]);
 },[selectedId,drafts.data]);
 const save=useMutation({
  mutationFn:()=>saveRecruitmentDraft({
   tenantId:currentTenantId!,id:selectedId,name,description,stateFilter,licenseFilter,steps,
  }),
  onSuccess:async id=>{
   setSelectedId(id);
   await Promise.all([
    qc.invalidateQueries({queryKey:['recruitment-draft-sequences',currentTenantId]}),
    qc.invalidateQueries({queryKey:['recruitment-sequence-preview',currentTenantId]}),
   ]);
  },
 });
 const replyReview=useMutation({
  mutationFn:(v:{id:string;decision:'interested'|'declined'|'ignore'|'opt_out'})=>
   reviewRecruitmentReply(currentTenantId!,v.id,v.decision),
  onSuccess:async()=>{
   await Promise.all([
    qc.invalidateQueries({queryKey:['recruitment-inbound-replies',currentTenantId]}),
    qc.invalidateQueries({queryKey:['therapist-prospect-review']}),
    qc.invalidateQueries({queryKey:['recruitment-campaign-preview']}),
    qc.invalidateQueries({queryKey:['recruitment-communication-timeline']}),
    qc.invalidateQueries({queryKey:['pipeline-connected-cards']}),
   ]);
  },
 });
 const newDraft=()=>{setSelectedId(null);setName('');setDescription('');setStateFilter('');setLicenseFilter('');setSteps([emptyStep()]);save.reset()};
 const updateStep=(index:number,update:Partial<RecruitmentDraftStep>)=>
  setSteps(prev=>prev.map((s,i)=>i===index?{...s,...update}:s));
 const valid=name.trim().length>=3&&steps.length>0&&
  steps.every(s=>s.subject.trim().length>=3&&s.bodyText.trim().length>=10&&
   Number.isInteger(s.delayDays)&&s.delayDays>=0&&s.delayDays<=90)&&
  (!stateFilter||/^[A-Za-z]{2}$/.test(stateFilter));
 if(!currentTenantId)return <p className="p-4">Select your CRM tenant to manage recruitment drafts.</p>;
 return <div className="space-y-5 p-2 md:p-4">
  <div className="flex flex-wrap justify-between gap-3">
   <div><h1 className="text-2xl font-bold">Recruitment sequences & replies</h1>
    <p className="text-sm text-muted-foreground">Configure drafts and triage replies without enabling campaign sending.</p></div>
   <Button variant="outline" asChild><Link to="/crm/recruitment/prospects">Back to therapist prospects</Link></Button>
  </div>
  <Card><CardHeader><CardTitle>Outbound email and SMS remain paused</CardTitle>
   <CardDescription>Drafts are not executable campaigns. Preview counts do not establish marketing consent.
    No send, schedule, enrollment, or activation action exists on this page.</CardDescription>
   </CardHeader><CardContent><p className="text-sm font-medium">All sequences are stored in draft-only tables, separate from production campaign schedulers.</p></CardContent></Card>
  <Card><CardHeader><CardTitle>Email sequence drafts</CardTitle>
   <CardDescription>Create up to six steps. Delays are measured in days, and the audience can be narrowed by state and license. Nothing is sent when you save a draft.</CardDescription>
   </CardHeader><CardContent className="space-y-4">
   {drafts.isError&&<p role="alert" className="text-destructive">{drafts.error.message}</p>}
   <div className="flex flex-wrap gap-2">
    <select aria-label="Choose recruitment draft" className="h-10 min-w-64 rounded border bg-background px-3 text-sm"
      value={selectedId??''} onChange={e=>e.target.value?setSelectedId(e.target.value):newDraft()}>
     <option value="">New draft</option>
     {(drafts.data??[]).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
    <Button variant="outline" onClick={newDraft}>New blank draft</Button>
   </div>
   <div className="grid gap-3 sm:grid-cols-2">
    <div className="space-y-1"><Label htmlFor="recruit-draft-name">Sequence name</Label>
     <Input id="recruit-draft-name" maxLength={120} value={name} disabled={!capabilities.mutate} onChange={e=>setName(e.target.value)} placeholder="Clinician introduction"/></div>
    <div className="space-y-1"><Label htmlFor="recruit-draft-state">State filter (optional, two-letter abbreviation)</Label>
     <Input id="recruit-draft-state" maxLength={2} value={stateFilter} disabled={!capabilities.mutate} onChange={e=>setStateFilter(e.target.value.toUpperCase())} placeholder="MO"/></div>
    <div className="space-y-1"><Label htmlFor="recruit-draft-license">License type contains (optional)</Label>
     <Input id="recruit-draft-license" maxLength={120} value={licenseFilter} disabled={!capabilities.mutate} onChange={e=>setLicenseFilter(e.target.value)} placeholder="LCSW"/></div>
    <div className="space-y-1"><Label htmlFor="recruit-draft-desc">Internal campaign description</Label>
     <Input id="recruit-draft-desc" maxLength={2000} value={description} disabled={!capabilities.mutate} onChange={e=>setDescription(e.target.value)}/></div>
   </div>
   {steps.map((step,i)=><div className="rounded-md border p-3 space-y-3" key={i}>
    <div className="flex items-center justify-between gap-2">
     <strong>Step {i+1}</strong>
     {capabilities.mutate&&steps.length>1&&<Button variant="outline" size="sm" onClick={()=>setSteps(prev=>prev.filter((_,idx)=>idx!==i))}>Remove step</Button>}
    </div>
    <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
     <div className="space-y-1"><Label htmlFor={'recruit-delay-'+i}>Delay in days</Label>
      <Input id={'recruit-delay-'+i} type="number" min={0} max={90} value={step.delayDays}
       disabled={!capabilities.mutate} onChange={e=>updateStep(i,{delayDays:Number(e.target.value)})}/></div>
     <div className="space-y-1"><Label htmlFor={'recruit-subject-'+i}>Subject</Label>
      <Input id={'recruit-subject-'+i} maxLength={200} value={step.subject} disabled={!capabilities.mutate}
       onChange={e=>updateStep(i,{subject:e.target.value})} placeholder="An invitation from ValorWell"/></div>
    </div>
    <div className="space-y-1"><Label htmlFor={'recruit-body-'+i}>Email body (plain text)</Label>
     <Textarea id={'recruit-body-'+i} rows={5} maxLength={6000} value={step.bodyText} disabled={!capabilities.mutate}
      onChange={e=>updateStep(i,{bodyText:e.target.value})} placeholder="Hello, I'd like to introduce ValorWell…"/></div>
   </div>)}
   {capabilities.mutate&&<div className="flex flex-wrap gap-2">
    {steps.length<6&&<Button variant="outline" onClick={()=>setSteps(prev=>[...prev,{...emptyStep(),delayDays:7}])}>Add follow-up step</Button>}
    <Button disabled={!valid||save.isPending} onClick={()=>save.mutate()}>{save.isPending?'Saving…':'Save draft only'}</Button>
   </div>}
   {save.isError&&<p role="alert" className="text-destructive">{save.error.message}</p>}
   {save.isSuccess&&<p role="status" className="text-sm">Draft saved. No emails or texts sent or scheduled.</p>}
   </CardContent></Card>
   {selectedId&&<Card><CardHeader><CardTitle>Audience preview for this draft</CardTitle>
    <CardDescription>Counts are read-only; prospective clinicians are never enrolled or sent messages here.</CardDescription>
    </CardHeader><CardContent className="space-y-2">
     {preview.isLoading&&<p>Calculating the matching prospects…</p>}
     {preview.isError&&<p role="alert" className="text-destructive">{preview.error.message}</p>}
     {preview.data&&<div className="grid gap-3 grid-cols-2 md:grid-cols-4 text-sm">
      <p><strong>{preview.data.matched}</strong> in audience</p>
      <p><strong>{preview.data.formatValid}</strong> format-valid emails</p>
      <p><strong>{preview.data.manuallyVerified}</strong> manually reviewed</p>
      <p><strong>{preview.data.documentedPermission}</strong> documented permissions</p>
      <p><strong>{preview.data.technicallyReady}</strong> technically ready</p>
      <p><strong>{preview.data.missing}</strong> missing emails</p>
      <p><strong>{preview.data.invalid}</strong> invalid emails</p>
      <p><strong>{preview.data.suppressed}</strong> suppressed</p>
      <p><strong>{preview.data.approvedForSending}</strong> approved for sending</p>
     </div>}
     <p className="text-sm font-medium">Sending disabled. A valid email or manually verified identity is not sufficient consent.</p>
    </CardContent></Card>}
  {selectedId&&<RecruitmentDeliveryLedgerPanel tenantId={currentTenantId} sequenceId={selectedId}/>}
  <Card><CardHeader><CardTitle>Incoming clinician replies</CardTitle>
   <CardDescription>Future inbound emails are matched only to a uniquely identified, manually verified prospect.
    Possible interest or declines are suggested for review, not treated as confirmed decisions.
    Explicit unambiguous unsubscribe messages are suppressed automatically.</CardDescription>
   </CardHeader><CardContent className="space-y-3">
    {replies.isLoading&&<p>Loading incoming recruiter replies…</p>}
    {replies.isError&&<p role="alert" className="text-destructive">{replies.error.message}</p>}
    {replies.data?.length===0&&<p className="text-sm text-muted-foreground">No verified clinician replies have been matched yet. Existing unrelated mailbox messages remain unaffected.</p>}
    {(replies.data??[]).map((r:RecruitmentInboundReply)=><div key={r.id} className="rounded border p-3 space-y-2">
     <div className="flex flex-wrap justify-between gap-2 text-sm">
      <strong><Link className="underline text-primary" to={'/crm/recruitment/prospects/'+r.prospectId}>{r.prospectName||'Open prospect'}</Link></strong>
      <span className="text-muted-foreground">{new Date(r.occurredAt).toLocaleString()}</span>
     </div>
     <p className="text-sm">{r.subject}</p>
     <p className="text-xs text-muted-foreground">{classifications[r.classification]??r.classification} · {r.reviewStatus}</p>
     {r.reviewStatus==='pending'&&capabilities.mutate&&<div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={replyReview.isPending} onClick={()=>replyReview.mutate({id:r.id,decision:'interested'})}>Confirmed interested</Button>
      <Button size="sm" variant="outline" disabled={replyReview.isPending} onClick={()=>replyReview.mutate({id:r.id,decision:'declined'})}>Declined / no contact</Button>
      <Button size="sm" variant="outline" disabled={replyReview.isPending} onClick={()=>replyReview.mutate({id:r.id,decision:'opt_out'})}>Unsubscribe</Button>
      <Button size="sm" variant="ghost" disabled={replyReview.isPending} onClick={()=>replyReview.mutate({id:r.id,decision:'ignore'})}>Not relevant</Button>
     </div>}
    </div>)}
    {replyReview.isError&&<p role="alert" className="text-destructive">{replyReview.error.message}</p>}
  </CardContent></Card>
 </div>;
}
