import {useEffect,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Link,useParams} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle,CardDescription} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {useCrmAuth} from '@/hooks/crm/useCrmAuth';
import {listTeamOwners} from '@/repositories/supabase/pipeline-team-owners';
import {listTherapistProspects,therapistProspectHistory,updateTherapistProspect,type TherapistProspect} from '@/repositories/supabase/therapist-prospects';

const pipelineLink='/crm/pipelines?pipeline=197bfeb7-a1d2-4c26-842f-045b5256d9e4';
function displayName(p:TherapistProspect){return [p.firstName,p.lastName].filter(Boolean).join(' ')||'Unnamed prospect'}
function toLocal(iso:string|null){
 if(!iso)return '';
 const date=new Date(iso);if(!Number.isFinite(date.getTime()))return '';
 return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
export default function TherapistProspectsPage(){
  const {id}=useParams();
  const {currentTenantId,capabilities}=useCrmAuth();
  const [page,setPage]=useState(1);
  const [searchInput,setSearchInput]=useState('');
  const [search,setSearch]=useState('');
  const qc=useQueryClient();
  const query=useQuery({
    queryKey:['therapist-prospect-review',currentTenantId,id??'',page,search],
    queryFn:()=>listTherapistProspects(currentTenantId!,id?1:page,id?1:50,id?'':search,id),
    enabled:!!currentTenantId,retry:false,
  });
  const owners=useQuery({queryKey:['crm-pipeline-team-owners',currentTenantId],
    queryFn:()=>listTeamOwners(currentTenantId!),enabled:!!currentTenantId,retry:false});
  const row=query.data?.items[0];
  const history=useQuery({
    queryKey:['therapist-prospect-history',currentTenantId,id],
    queryFn:()=>therapistProspectHistory(currentTenantId!,id!),
    enabled:!!currentTenantId&&!!id,retry:false,
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
      <div><h1 className="text-2xl font-bold">{id?'Therapist prospect':'Therapist recruitment prospects'}</h1>
        <p className="text-sm text-muted-foreground">Prospects remain distinct from submitted clinician applications. Campaign email and SMS sending is paused.</p>
      </div>
      <div className="flex gap-2"><Button asChild variant="outline"><Link to={pipelineLink}>Clinician pipeline</Link></Button>
        {id&&<Button asChild variant="outline"><Link to="/crm/recruitment/prospects">All prospects</Link></Button>}</div>
    </div>
    {query.isLoading&&<p>Loading tenant-authorized prospects…</p>}
    {query.isError&&<p role="alert" className="text-destructive">{query.error.message}</p>}
    {!id&&<Card><CardHeader><CardTitle>Recruitment review queue</CardTitle>
      <CardDescription>Search is server-side across all prospects; 50 records per page. No campaigns are triggered by reviewing a prospect.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <form className="flex gap-2" onSubmit={event=>{event.preventDefault();setPage(1);setSearch(searchInput.trim())}}>
          <Input aria-label="Search prospects" placeholder="Search name, email, state or licence" value={searchInput} onChange={event=>setSearchInput(event.target.value)}/>
          <Button type="submit">Search</Button>
        </form>
        <p role="status" className="text-sm">{query.data?.total??0} matching prospects · Page {page}</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-sm">
          <thead><tr className="border-b text-left"><th className="p-2">Prospect</th><th className="p-2">State</th><th className="p-2">Licence</th><th className="p-2">Review stage</th><th className="p-2">Email</th><th className="p-2">Owner</th></tr></thead>
          <tbody>{(query.data?.items??[]).map(p=><tr key={p.id} className="border-b">
            <td className="p-2"><Link className="text-primary underline" to={'/crm/recruitment/prospects/'+p.id}>{displayName(p)}</Link></td>
            <td className="p-2">{p.state??'—'}</td><td className="p-2">{p.licenseType??'—'}</td>
            <td className="p-2">{p.status==='blocked'?'Blocked':p.status==='ready'?'Ready for review':'Needs review'}</td>
            <td className="p-2">{p.email&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)?'Present':'Unavailable'}</td>
            <td className="p-2">{owners.data?.find(x=>x.id===p.ownerProfileId)?.name??(p.ownerProfileId?'Assigned team member':'Unassigned')}</td>
          </tr>)}</tbody></table></div>
        <div className="flex gap-2"><Button variant="outline" disabled={page<=1} onClick={()=>setPage(n=>n-1)}>Previous</Button>
          <Button variant="outline" disabled={page*50>=(query.data?.total??0)} onClick={()=>setPage(n=>n+1)}>Next</Button></div>
      </CardContent></Card>}
    {id&&!query.isLoading&&!row&&!query.isError&&<p>Prospect not found or not authorized in this tenant.</p>}
    {id&&row&&<><Card><CardHeader><CardTitle>{displayName(row)}</CardTitle><CardDescription>
      Source record remains in protected therapist outreach staging. No automated communication is enabled.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
        <p><strong>Email:</strong> {row.email??'Unavailable'}</p>
        <p><strong>Phone:</strong> {row.phone??'Unavailable'}</p>
        <p><strong>State:</strong> {row.state??'Unavailable'}</p>
        <p><strong>License:</strong> {row.licenseType??'Unavailable'}</p>
        <p><strong>LinkedIn:</strong> {row.linkedIn??'Unavailable'}</p>
        <p><strong>Contactability:</strong> {row.contactable&&!row.exclusionReason?'Not suppressed':'Suppressed / excluded'}</p>
        {row.exclusionReason&&<p className="sm:col-span-2 text-destructive">Exclusion reason: {row.exclusionReason}</p>}
      </CardContent></Card>
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
