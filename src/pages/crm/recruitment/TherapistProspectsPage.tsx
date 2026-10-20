import {useEffect,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Link,useParams,useSearchParams} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle,CardDescription} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {useCrmAuth} from '@/hooks/crm/useCrmAuth';
import {listTeamOwners} from '@/repositories/supabase/pipeline-team-owners';
import {therapistProspectHistory,updateTherapistProspect,type TherapistProspect} from '@/repositories/supabase/therapist-prospects';
import {listRecruitmentReviewProspects} from '@/repositories/supabase/recruitment-review';
import {RecruitmentPreviewPanel,RecruitmentQualificationPanel} from './RecruitmentQualificationPanel';
import {RecruitmentFilters} from './RecruitmentFilters';
import {RecruitmentCommunicationsPanel} from './RecruitmentCommunicationsPanel';
import {RecruitmentDeliverySafetyPanel} from './RecruitmentDeliverySafetyPanel';
import {RecruitmentEnrichmentPanel} from './RecruitmentEnrichmentPanel';

const US_STATES:ReadonlyArray<readonly [string,string]>=[["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["PR","Puerto Rico"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"]];
const pipelineLink='/crm/pipelines?pipeline=197bfeb7-a1d2-4c26-842f-045b5256d9e4';
function displayName(p:TherapistProspect){return [p.firstName,p.lastName].filter(Boolean).join(' ')||'Unnamed prospect'}
function toLocal(iso:string|null){
 if(!iso)return '';
 const date=new Date(iso);if(!Number.isFinite(date.getTime()))return '';
 return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
export default function TherapistProspectsPage(){
  const {id}=useParams();
  const {currentTenantId,userId,crmRole}=useCrmAuth();
  return <TherapistProspectWorkspace key={`${currentTenantId}:${userId}:${crmRole}:${id??'queue'}`} />;
}
function TherapistProspectWorkspace(){
  const {id}=useParams();
  const {currentTenantId,capabilities,userId,crmRole,isAuthenticated}=useCrmAuth();
  const [queueParams,setQueueParams]=useSearchParams();
  const rawPage=Number(queueParams.get('page'));
  const page=Number.isSafeInteger(rawPage)&&rawPage>0&&rawPage<=1000000?rawPage:1;
  const search=(queueParams.get('q')??'').slice(0,200);
  const [searchInput,setSearchInput]=useState(search);
  useEffect(()=>setSearchInput(search),[search]);
  const stateFilter=US_STATES.some(([code])=>code===queueParams.get('state'))?queueParams.get('state')!:'';
  const workflowValues=['review','ready','blocked','recruiting:not_contacted','recruiting:contact_attempted','recruiting:replied','recruiting:interested','recruiting:application_handoff','recruiting:applicant_linked','recruiting:closed'];
  const qualityValues=['email_valid','email_missing','email_invalid','email_duplicate','suppressed','possible_match','email_unverified','preview_eligible'];
  const workflowFilter=workflowValues.includes(queueParams.get('workflow')??'')?queueParams.get('workflow')!:'';
  const qualityFilter=qualityValues.includes(queueParams.get('quality')??'')?queueParams.get('quality')!:'';
  const dueFilter=['overdue','next_7_days','missing_action','no_due_date'].includes(queueParams.get('due')??'')?queueParams.get('due')!:'';
  const mineOnly=queueParams.get('mine')==='1';
  const queueSearch=queueParams.toString()?'?'+queueParams.toString():'';
  const setQueueFilter=(key:string,value:string)=>setQueueParams(current=>{
    const next=new URLSearchParams(current);
    if(value)next.set(key,value);else next.delete(key);
    if(key!=='page')next.delete('page');
    return next;
  });
  const resetQueue=()=>{
    setSearchInput('');
    setQueueParams(current=>{
      const next=new URLSearchParams(current);
      for(const key of ['q','page','state','workflow','quality','due','mine'])next.delete(key);
      return next;
    });
  };
  const qc=useQueryClient();
  const query=useQuery({
    queryKey:['therapist-prospect-review',currentTenantId,id??'',page,search,stateFilter,workflowFilter,qualityFilter,dueFilter,mineOnly,userId,crmRole],
    queryFn:()=>listRecruitmentReviewProspects(currentTenantId!,id?1:page,id?1:50,{
      search:id?'':search,state:id?'':stateFilter,
      workflow:id?'':workflowFilter,quality:id?'':qualityFilter,due:id?'':dueFilter,
      owner:id||!mineOnly?'':userId,
    },id),
    enabled:isAuthenticated&&!!currentTenantId,retry:false,
  });
  const owners=useQuery({queryKey:['crm-pipeline-team-owners',currentTenantId,userId,crmRole],
    queryFn:()=>listTeamOwners(currentTenantId!),enabled:isAuthenticated&&!!currentTenantId,retry:false});
  const row=query.isError?undefined:query.data?.items[0];
  const history=useQuery({
    queryKey:['therapist-prospect-history',currentTenantId,id,userId,crmRole],
    queryFn:()=>therapistProspectHistory(currentTenantId!,id!),
    enabled:isAuthenticated&&!!currentTenantId&&!!id,retry:false,
  });
  const [status,setStatus]=useState<'review'|'ready'|'blocked'>('review');
  const [owner,setOwner]=useState('');
  const [nextAction,setNextAction]=useState('');
  const [due,setDue]=useState('');
  const [notes,setNotes]=useState('');
  const [reason,setReason]=useState('');
  useEffect(()=>{
    if(!id||!row)return;
    setStatus(row.status);setOwner(row.ownerProfileId??'');
    setNextAction(row.nextAction??'');setDue(toLocal(row.nextActionDueAt));
    setNotes(row.notes??'');setReason('');
  },[id,row]);
  const save=useMutation({
    mutationFn:async()=>{
      if(!row||!currentTenantId)throw new Error('Select a valid prospect.');
      if(reason.trim().length<8)throw new Error('Explain the change in at least eight characters.');
      await updateTherapistProspect({
        tenantId:currentTenantId,prospectId:row.id,expectedVersion:row.version,
        ownerProfileId:owner||null,status,
        nextAction:nextAction.trim()||null,
        nextActionDueAt:due?new Date(due).toISOString():null,
        notes:notes.trim()||null,reason:reason.trim(),
      });
    },
    onSuccess:async()=>{
      await Promise.all([
        qc.invalidateQueries({queryKey:['therapist-prospect-review']}),
        qc.invalidateQueries({queryKey:['therapist-prospect-history']}),
        qc.invalidateQueries({queryKey:['pipeline-connected-cards']}),
      ]);
    },
  });
  const canEdit=capabilities.mutate;
  if(!currentTenantId)return <p className="p-4">Select a CRM tenant to review therapist prospects.</p>;
  return <div className="space-y-5 p-2 md:p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">{id?'Cold outreach therapist prospect':'Cold outreach therapist prospects'}</h1>
        <p className="text-sm text-muted-foreground">Prospects remain distinct from submitted clinician applications. Campaign email and SMS sending is paused.</p>
      </div>
      <div className="flex gap-2"><Button asChild variant="outline"><Link to={pipelineLink}>Clinician pipeline</Link></Button>
        <Button asChild variant="outline"><Link to="/crm/recruitment/applicants">Submitted applications &amp; staff handoff</Link></Button>
        <Button asChild variant="outline"><Link to="/crm/recruitment/sequences">Recruitment sequences & replies</Link></Button>
        {id&&<Button asChild variant="outline"><Link to={'/crm/recruitment/prospects'+queueSearch}>Back to filtered queue</Link></Button>}</div>
    </div>
    {query.isLoading&&<p>Loading tenant-authorized prospects…</p>}
    {query.isError&&<p role="alert" className="text-destructive">{query.error.message}</p>}
    {query.isError&&<Button variant="outline" onClick={()=>void query.refetch()}>Retry prospects</Button>}
    {!id&&<RecruitmentPreviewPanel tenantId={currentTenantId}/>}
    {!id&&<Card><CardHeader><CardTitle>Recruitment review queue</CardTitle>
      <CardDescription>Search names, full state names or abbreviations, and narrow results by primary or licensed state. Filters can be combined. Results are server-paged (50 per page), and no campaigns are triggered.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();setQueueFilter('q',searchInput.trim())}}>
          <div className="min-w-[220px] flex-1 space-y-1">
            <Label htmlFor="prospect-search">Search prospects</Label>
            <Input id="prospect-search" aria-label="Search prospects" placeholder="Search by name, email, or license type" value={searchInput} onChange={event=>setSearchInput(event.target.value)}/>
          </div>
          <div className="min-w-[190px] space-y-1">
            <Label htmlFor="prospect-state-filter">Primary or licensed state</Label>
            <select id="prospect-state-filter" aria-label="Filter by state" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={stateFilter}
              onChange={event=>{setQueueFilter('state',event.target.value);}}>
              <option value="">All states</option>
              {US_STATES.map(([code,name])=><option key={code} value={code}>{name} ({code})</option>)}
            </select>
          </div>
          <Button type="submit">Search</Button>
          {(stateFilter||search||workflowFilter||qualityFilter||dueFilter||mineOnly)&&<Button type="button" variant="outline" onClick={resetQueue}>Clear filters</Button>}
        </form>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Recruitment quick views">
          {[
            {label:'Uncontacted, technically reviewed',workflow:'recruiting:not_contacted',quality:'preview_eligible',due:'',mine:''},
            {label:'Responded',workflow:'recruiting:replied',quality:'',due:'',mine:''},
            {label:'Applications linked',workflow:'recruiting:applicant_linked',quality:'',due:'',mine:''},
            {label:'Blocked',workflow:'blocked',quality:'',due:'',mine:''},
            {label:'Needs review',workflow:'review',quality:'',due:'',mine:''},
            {label:'My overdue follow-ups',workflow:'',quality:'',due:'overdue',mine:'1'},
          ].map(view=><Button key={view.label} size="sm" variant="outline" onClick={()=>setQueueParams(current=>{
            const next=new URLSearchParams(current);
            next.delete('page');
            for(const key of ['workflow','quality','due','mine'] as const){
              if(view[key])next.set(key,view[key]);else next.delete(key);
            }
            return next;
          })}>{view.label}</Button>)}
        </div>
        <p className="text-xs text-muted-foreground">Quick views retain your name and state filters. Technical review is not permission to send outreach.</p>
        <RecruitmentFilters workflow={workflowFilter} quality={qualityFilter} due={dueFilter} mineOnly={mineOnly}
          onWorkflow={v=>setQueueFilter('workflow',v)} onQuality={v=>setQueueFilter('quality',v)}
          onDue={v=>setQueueFilter('due',v)} onMine={v=>setQueueFilter('mine',v?'1':'')}/>
        <p role="status" className="text-sm">{query.isLoading?'Loading prospects…':query.isError?'Prospects could not be loaded':`${query.data?.total??0} matching prospects · Page ${page}`}</p>
        {!query.isError&&<div className="overflow-x-auto"><table className="w-full min-w-[650px] text-sm">
          <thead><tr className="border-b text-left"><th className="p-2">Prospect</th><th className="p-2">State</th><th className="p-2">Licence</th><th className="p-2">Review stage</th><th className="p-2">Email quality</th><th className="p-2">Follow-up</th><th className="p-2">Owner</th></tr></thead>
          <tbody>{(query.data?.items??[]).map(p=><tr key={p.id} className="border-b">
            <td className="p-2"><Link className="text-primary underline" to={'/crm/recruitment/prospects/'+p.id+queueSearch}>{displayName(p)}</Link><span className="ml-2 inline-flex rounded-full border px-2 py-0.5 text-xs">Cold</span></td>
            <td className="p-2">{p.state??'—'}</td><td className="p-2">{p.licenseType??'—'}</td>
            <td className="p-2">{p.status==='blocked'?'Blocked':p.status==='ready'?'Ready for review':'Needs review'}</td>
            <td className="p-2">{p.emailQuality}{p.suppressed?' · suppressed':''}</td>
            <td className="p-2">{p.nextActionDueAt?new Date(p.nextActionDueAt).toLocaleDateString():(p.nextAction?'Unscheduled':'No next action')}</td>
            <td className="p-2">{owners.data?.find(x=>x.id===p.ownerProfileId)?.name??(p.ownerProfileId?'Assigned team member':'Unassigned')}</td>
          </tr>)}</tbody></table></div>}
        <div className="flex gap-2"><Button variant="outline" disabled={query.isFetching||query.isError||page<=1} onClick={()=>setQueueFilter('page',String(page-1))}>Previous</Button>
          <Button variant="outline" disabled={query.isFetching||query.isError||page*50>=(query.data?.total??0)} onClick={()=>setQueueFilter('page',String(page+1))}>Next</Button></div>
      </CardContent></Card>}
    {id&&!query.isLoading&&!row&&!query.isError&&<p>Prospect not found or not authorized in this tenant.</p>}
    {id&&row&&<><Card><CardHeader><CardTitle>{displayName(row)}</CardTitle><CardDescription>
      Source record remains in protected therapist outreach staging. No automated communication is enabled.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
        <p><strong>Acquisition source:</strong> Cold outreach prospect</p>
        <p><strong>Email:</strong> {row.email??'Unavailable'}</p>
        <p><strong>Phone:</strong> {row.phone??'Unavailable'}</p>
        <p><strong>State:</strong> {row.state??'Unavailable'}</p>
        <p><strong>License:</strong> {row.licenseType??'Unavailable'}</p>
        <p><strong>LinkedIn:</strong> {row.linkedIn??'Unavailable'}</p>
        <p><strong>Contactability:</strong> {row.contactable&&!row.exclusionReason?'Not suppressed':'Suppressed / excluded'}</p>
        {row.exclusionReason&&<p className="sm:col-span-2 text-destructive">Exclusion reason: {row.exclusionReason}</p>}
      </CardContent></Card>
      <RecruitmentCommunicationsPanel tenantId={currentTenantId} row={row} canEdit={canEdit}/>
      <RecruitmentQualificationPanel tenantId={currentTenantId} row={row} canEdit={canEdit}/>
      <RecruitmentDeliverySafetyPanel tenantId={currentTenantId} prospectId={row.id} canEdit={canEdit}/>
      <RecruitmentEnrichmentPanel tenantId={currentTenantId} prospectId={row.id} canEdit={canEdit}/>
      <Card><CardHeader><CardTitle>Review, ownership and next action</CardTitle>
        <CardDescription>Changes create an audit event; no email, SMS or campaign enrolment occurs. Ready only represents a human review decision.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="prospect-status">Review stage</Label>
          <select id="prospect-status" className="w-full rounded border bg-background p-2" value={status}
            disabled={!canEdit} onChange={e=>setStatus(e.target.value as typeof status)}>
            <option value="review">Needs review</option><option value="ready" disabled={!row.contactable||!!row.exclusionReason}>Reviewed / ready</option><option value="blocked">Blocked</option>
          </select></div>
        <div className="space-y-1"><Label htmlFor="prospect-owner">Assigned owner</Label>
          <select id="prospect-owner" className="w-full rounded border bg-background p-2" value={owner}
            disabled={!canEdit} onChange={e=>setOwner(e.target.value)}>
            <option value="">Unassigned</option>
            {owner&&!(owners.data??[]).some(x=>x.id===owner)&&<option value={owner}>Current assigned owner</option>}
            {(owners.data??[]).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}
          </select></div>
        <div className="space-y-1"><Label htmlFor="prospect-next">Next action</Label>
          <Input id="prospect-next" value={nextAction} maxLength={500} disabled={!canEdit} onChange={e=>setNextAction(e.target.value)}/></div>
        <div className="space-y-1"><Label htmlFor="prospect-due">Due date and time</Label>
          <Input id="prospect-due" type="datetime-local" value={due} disabled={!canEdit} onChange={e=>setDue(e.target.value)}/></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="prospect-notes">Internal review notes</Label>
          <Textarea id="prospect-notes" maxLength={4000} value={notes} disabled={!canEdit} onChange={e=>setNotes(e.target.value)}/></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="prospect-reason">Reason for change (required for audit)</Label>
          <Input id="prospect-reason" maxLength={500} value={reason} disabled={!canEdit} placeholder="What changed and why?" onChange={e=>setReason(e.target.value)}/></div>
        {save.isError&&<p role="alert" className="sm:col-span-2 text-destructive">{save.error.message}</p>}
        {canEdit&&<Button disabled={save.isPending||reason.trim().length<8} onClick={()=>save.mutate()}>{save.isPending?'Saving…':'Save review and follow-up'}</Button>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Review history</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        {history.isLoading&&<p>Loading history…</p>}
        {history.isError&&<p className="text-destructive">History unavailable.</p>}
        {history.data?.length===0&&<p>No changes recorded yet.</p>}
        {history.data?.map((event,index)=><div className="border-b pb-2" key={index}>
          <p>{new Date(event.when).toLocaleString()} · {event.from??'New'} → {event.to}</p>
          <p className="text-muted-foreground">{event.reason}</p>
        </div>)}
      </CardContent></Card></>}
  </div>;
}
