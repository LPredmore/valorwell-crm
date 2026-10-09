import {useMemo,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle,CardDescription} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Badge} from '@/components/ui/badge';
import {getPipelineCardSubjects,listAssociatedOrganizations} from '@/repositories/supabase/pipeline-subjects';
import {listPipelineResearch,enrollResearchCandidate,createSourceOrganization,type PipelineSourceKind} from '@/repositories/supabase/pipeline-research';
import type {CrmPipeline,CrmPipelineRecord} from '@/domain/pipelines/models';

export function ResearchSourceReview({pipeline,kind,canEdit}:{
  pipeline:CrmPipeline;kind:Extract<PipelineSourceKind,'institutional_recruiting'|'va_facilities'>;canEdit:boolean;
}){
  const client=useQueryClient();
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState('');
  const [existingOrg,setExistingOrg]=useState('');
  const [primaryName,setPrimaryName]=useState('');
  const [primaryEmail,setPrimaryEmail]=useState('');
  const [confirmPrimary,setConfirmPrimary]=useState(false);
  const [confirmRegional,setConfirmRegional]=useState(false);
  const [error,setError]=useState('');
  const research=useQuery({queryKey:['pipeline-research',pipeline.id,kind],
    queryFn:()=>listPipelineResearch(pipeline,kind),retry:false});
  const organizations=useQuery({queryKey:['pipeline-available-orgs',pipeline.tenant_id],
    queryFn:()=>listAssociatedOrganizations(pipeline.tenant_id),enabled:canEdit,retry:false});
  const selectedOrg=useQuery({queryKey:['pipeline-existing-primary',pipeline.id,existingOrg],
    queryFn:()=>getPipelineCardSubjects(pipeline,[{organization_id:existingOrg} as CrmPipelineRecord]),
    enabled:!!existingOrg,retry:false});
  const source=(research.data??[]).find(x=>x.id===selected);
  const candidates=useMemo(()=>(research.data??[]).filter(x=>
    !x.linkedOrganizationId && (x.name+' '+x.state+' '+x.sourceContact+' '+x.sourceEmail).toLowerCase().includes(search.toLowerCase())
  ),[research.data,search]);
  const mutation=useMutation({mutationFn:async(action:()=>Promise<unknown>)=>action(),
    onSuccess:async()=>{setError('');setSelected('');setConfirmPrimary(false);setExistingOrg('');
      await Promise.all([client.invalidateQueries({queryKey:['pipeline-research',pipeline.id]}),
        client.invalidateQueries({queryKey:['pipeline-records',pipeline.id]}),
        client.invalidateQueries({queryKey:['pipeline-card-subjects',pipeline.id]}),
        client.invalidateQueries({queryKey:['pipeline-available-orgs',pipeline.tenant_id]})]);}});
  const submit=async(fn:()=>Promise<unknown>)=>{
    setError('');try{await mutation.mutateAsync(fn);}catch(err){setError(err instanceof Error?err.message:'Could not enroll source record');}
  };
  const pick=(id:string)=>{
    const row=(research.data??[]).find(x=>x.id===id);
    setSelected(id);setExistingOrg('');
    setPrimaryName(row?.sourceContact??'');setPrimaryEmail(row?.sourceEmail??'');
    setConfirmPrimary(false);setConfirmRegional(false);setError('');
  };
  const total=(research.data??[]).length;
  const linked=(research.data??[]).filter(x=>x.linkedOrganizationId).length;
  const existingPrimary=selectedOrg.data?.[existingOrg]?.primaryContact;
  const canLink=!!existingOrg&&!!existingPrimary&&existingPrimary!=='Primary contact needs review';
  return <Card>
    <CardHeader>
      <CardTitle>Research records awaiting CRM relationship linking</CardTitle>
      <CardDescription>
        {kind==='va_facilities'?'VA regional facility contact research':'State-by-state therapist employment and career-office research'}.
        Link to an existing CRM organization, or confirm a real person's contact details to create a new one. An organization's only linked contact becomes Primary automatically. Research names and shared departmental inboxes are not imported without review.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm"><Badge variant="secondary">{total} researched entries</Badge>
        <Badge variant="outline">{linked} linked</Badge><Badge variant="outline">{total-linked} awaiting review</Badge></div>
      {research.isError&&<p role="alert" className="text-destructive">{research.error.message}</p>}
      <Input placeholder="Filter by facility, state, contact, or email" aria-label="Filter researched organizations" value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="space-y-1 max-h-72 overflow-y-auto rounded border">
        {candidates.slice(0,150).map(x=><button type="button" key={x.id} onClick={()=>pick(x.id)}
          className={'flex w-full flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm hover:bg-muted '+(x.id===selected?'bg-muted':'')}>
          <span><strong>{x.name}</strong> · {x.state}<span className="block text-muted-foreground">{x.sourceContact} · {x.sourceEmail}</span></span>
          <span className="text-xs">{x.id===selected?'Selected':'Review'}</span>
        </button>)}
        {!candidates.length&&<p className="p-3 text-sm text-muted-foreground">No remaining research records match.</p>}
      </div>
      {source&&<div className="space-y-4 rounded border p-4">
        <h3 className="font-semibold">{source.name}</h3>
        <p className="text-sm">Research contact: {source.sourceContact||'Not named'} ({source.sourceRole||'role unspecified'}). Email: {source.sourceEmail||'Not provided'}.</p>
        <p className="text-xs text-muted-foreground">{source.detail}. This is a researched candidate, not necessarily your primary relationship.</p>
        <p className="text-sm">You may also create or update a contact and organization in the <Link className="underline" to="/crm/business-development/organizations">Organizations directory</Link> before linking here.</p>
        {canEdit&&<div className="space-y-2 rounded border p-3">
          <h4 className="font-semibold text-sm">Link to an existing organization</h4>
          <select aria-label="Existing CRM organization" className="w-full rounded border bg-background p-2 text-sm" value={existingOrg} onChange={e=>setExistingOrg(e.target.value)}>
            <option value="">Choose an organization with one existing primary</option>
            {(organizations.data??[]).map(o=><option value={o.id} key={o.id}>{o.name}</option>)}
          </select>
          {existingOrg&&<p className="text-sm">Global primary contact: {existingPrimary??'Checking…'}</p>}
          <Button size="sm" disabled={!canLink||mutation.isPending} onClick={()=>submit(()=>enrollResearchCandidate(pipeline,source.id,existingOrg))}>
            Link source and enroll organization
          </Button>
        </div>}
        {canEdit&&<div className="space-y-3 rounded border p-3">
          <h4 className="font-semibold text-sm">Create a new organization from this research</h4>
          <p className="text-sm text-muted-foreground">Confirm this is a real, correctly associated contact—not a department mailbox. The first/only contact is automatically Primary for the entire organization, across all pipelines.</p>
          <div className="space-y-1"><Label htmlFor="research-primary-name">Contact person's full name</Label>
            <Input id="research-primary-name" value={primaryName} onChange={e=>{setPrimaryName(e.target.value);setConfirmPrimary(false);}}/></div>
          <div className="space-y-1"><Label htmlFor="research-primary-email">Contact person's email</Label>
            <Input id="research-primary-email" type="email" value={primaryEmail} onChange={e=>{setPrimaryEmail(e.target.value);setConfirmPrimary(false);}}/></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmPrimary}
            onChange={e=>setConfirmPrimary(e.target.checked)}/>
            <span>I confirm this is a real person associated with this organization, not a shared department inbox. As the only contact, they will automatically be Primary.</span>
          </label>
          {kind==='va_facilities'&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmRegional} onChange={e=>setConfirmRegional(e.target.checked)}/>
            <span>I confirm this organization represents the regional VA referral facility, not a separate subordinate clinic. Otherwise, link this source entry to its existing parent regional facility above.</span>
          </label>}
          <Button size="sm" disabled={mutation.isPending||!confirmPrimary||(kind==='va_facilities'&&!confirmRegional)||!primaryName.trim()||!primaryEmail.includes('@')}
            onClick={()=>submit(()=>createSourceOrganization(pipeline,source.id,primaryName,primaryEmail,confirmRegional))}>
            Create organization and enroll
          </Button>
        </div>}
        {error&&<p role="alert" className="rounded border border-destructive p-2 text-sm text-destructive">{error}</p>}
      </div>}
    </CardContent>
  </Card>;
}
