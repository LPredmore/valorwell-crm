import { useMemo,useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { pipelinesRepository } from '@/repositories/supabase/pipelines';
import { listPipelineSubjects,getPipelineCardSubjects,listAssociatedOrganizations } from '@/repositories/supabase/pipeline-subjects';
import { listConnectedPipelineCards,type ConnectedPipelineCard } from '@/repositories/supabase/connected-pipeline-cards';
import {getPipelineSourceKind,donorValuesByContact} from '@/repositories/supabase/pipeline-research';
import {ResearchSourceReview} from './ResearchSourceReview';
import {PipelineDragContext,KanbanRecordDrag,KanbanStageDrop} from './KanbanDnd';
import {PipelineActionEditor} from './PipelineActionEditor';
import {canMovePipelineCard,matchesPipelineView,type PipelineViewMode,type AttentionFilter,type OwnerFilter} from '@/domain/pipelines/board-view';
import {
  availableSortFields,builtinSortFields,cardFieldLabels,comparePipelineRecords,
  mandatoryCardFields,normalizePipelineFieldKey,
  type CrmPipeline,type CrmPipelineField,type CrmPipelineRecord,type PipelineFieldType,type PipelineSubject,
} from '@/domain/pipelines/models';

const fieldTypes:PipelineFieldType[]=['text','number','currency','date','datetime','boolean','url','select','multiselect'];
function usePipeData(p:CrmPipeline|null,limit:number) {
  const enabled=!!p;
  const stages=useQuery({queryKey:['pipeline-stages',p?.id],queryFn:()=>pipelinesRepository.stages(p!),enabled,retry:false});
  const fields=useQuery({queryKey:['pipeline-fields',p?.id],queryFn:()=>pipelinesRepository.fields(p!),enabled,retry:false});
  const records=useQuery({queryKey:['pipeline-records',p?.id,limit],queryFn:()=>pipelinesRepository.records(p!,limit),enabled:enabled&&p?.source_mode==='manual',retry:false});
  const connected=useQuery({queryKey:['pipeline-connected-cards',p?.id],queryFn:()=>listConnectedPipelineCards(p!,stages.data??[]),enabled:enabled&&p?.source_mode==='connected'&&!!stages.data,retry:false});
  const subjects=useQuery({queryKey:['pipeline-card-subjects',p?.id,records.dataUpdatedAt],queryFn:()=>getPipelineCardSubjects(p!,records.data??[]),enabled:enabled&&p?.source_mode==='manual'&&!!records.data,retry:false});
  return {stages,fields,records,subjects,connected};
}
export default function PipelineHubPage(){
  const {currentTenantId,userId,crmRole,capabilities}=useCrmAuth();
  const admin=crmRole==='crm_admin';
  const qc=useQueryClient();
  const [selected,setSelected]=useState<string>('');
  const [tab,setTab]=useState<'board'|'settings'>('board');
  const [newName,setNewName]=useState('');
  const [newSubject,setNewSubject]=useState<PipelineSubject>('organization');
  const [stageName,setStageName]=useState('');
  const [fieldLabel,setFieldLabel]=useState('');
  const [fieldType,setFieldType]=useState<PipelineFieldType>('text');
  const [fieldOptions,setFieldOptions]=useState('');
  const [findSubject,setFindSubject]=useState('');
  const [enrollId,setEnrollId]=useState('');
  const [associatedOrgId,setAssociatedOrgId]=useState('');
  const [sortKey,setSortKey]=useState('updated_at');
  const [viewMode,setViewMode]=useState<PipelineViewMode>('board');
  const [searchText,setSearchText]=useState('');
  const [stageFilter,setStageFilter]=useState('');
  const [attention,setAttention]=useState<AttentionFilter>('all');
  const [ownerFilter,setOwnerFilter]=useState<OwnerFilter>('all');
  const [recordLimit,setRecordLimit]=useState(200);
  const [saveName,setSaveName]=useState('');
  const [activeSavedView,setActiveSavedView]=useState('');
  const [fromStage,setFromStage]=useState('');
  const [toStage,setToStage]=useState('');
  const [ruleAllowed,setRuleAllowed]=useState(true);
  const [selectedRecords,setSelectedRecords]=useState<string[]>([]);
  const [bulkStage,setBulkStage]=useState('');
  const list=useQuery({queryKey:['crm-pipelines',currentTenantId],queryFn:()=>pipelinesRepository.list(currentTenantId!),enabled:!!currentTenantId,retry:false});
  const p=list.data?.find(x=>x.id===selected)??list.data?.[0]??null;
  const {stages,fields,records,subjects,connected}=usePipeData(p,recordLimit);
  const rules=useQuery({queryKey:['pipeline-stage-rules',p?.id],queryFn:()=>pipelinesRepository.stageRules(p!),enabled:!!p&&p.source_mode==='manual',retry:false});
  const saved=useQuery({queryKey:['pipeline-saved-views',p?.id,userId],queryFn:()=>pipelinesRepository.savedViews(p!,userId!),enabled:!!p&&!!userId,retry:false});
  const sourceBinding=useQuery({queryKey:['pipeline-source-binding',p?.id],
    queryFn:()=>getPipelineSourceKind(p!),enabled:!!p,retry:false});
  const giving=useQuery({queryKey:['pipeline-donor-giving',p?.id,records.dataUpdatedAt],
    queryFn:()=>donorValuesByContact(p!,[...new Set((records.data??[])
      .map(row=>row.contact_id).filter((id):id is string=>!!id))]),
    enabled:!!p&&sourceBinding.data==='donor_giving'&&!!records.data,retry:false});
  const candidates=useQuery({queryKey:['pipeline-subject-picker',p?.id,findSubject],queryFn:()=>listPipelineSubjects(p!,findSubject),enabled:!!p&&p.source_mode==='manual',retry:false});
  const relatedOrganizations=useQuery({queryKey:['pipeline-optional-organizations',currentTenantId],queryFn:()=>listAssociatedOrganizations(currentTenantId!),enabled:!!p&&p.source_mode==='manual'&&p.subject_type==='person'&&!!currentTenantId,retry:false});
  const mutation=useMutation({
    mutationFn:async (fn:()=>Promise<unknown>)=>fn(),
    onSuccess:()=>qc.invalidateQueries({queryKey:['crm-pipelines']}),
  });
  const [actionError,setActionError]=useState('');
  const busy=mutation.isPending;
  const act=async(fn:()=>Promise<unknown>)=>{
    setActionError('');
    try{await mutation.mutateAsync(fn);await Promise.all([
      qc.invalidateQueries({queryKey:['pipeline-stages',p?.id]}),
      qc.invalidateQueries({queryKey:['pipeline-fields',p?.id]}),
      qc.invalidateQueries({queryKey:['pipeline-records',p?.id]}),
      qc.invalidateQueries({queryKey:['pipeline-card-subjects',p?.id]}),
      qc.invalidateQueries({queryKey:['pipeline-saved-views',p?.id]}),
      qc.invalidateQueries({queryKey:['pipeline-stage-rules',p?.id]}),
    ]);}
    catch(e){setActionError(e instanceof Error?e.message:'Action failed');}
  };
  const sorted=useMemo(()=>{
    const originals=p?.source_mode==='connected'?(connected.data??[]):(records.data??[]);
    const values=originals.map(row=>{
      if(p?.source_mode!=='manual'||!('contact_id' in row)||!row.contact_id)return row;
      const donation=giving.data?.[row.contact_id];
      return donation?{...row,field_values:{...row.field_values,...donation}}:row;
    });
    return [...values].sort((a,b)=>comparePipelineRecords(a as CrmPipelineRecord,b as CrmPipelineRecord,sortKey));
  },[p?.source_mode,connected.data,records.data,giving.data,sortKey]);
  const labelOf=(r:(typeof sorted)[number])=>{
    if('displayName' in r&&typeof r.displayName==='string')return r.displayName;
    const manual=r as CrmPipelineRecord;
    const id=p?.subject_type==='person'?manual.contact_id:manual.organization_id;
    return subjects.data?.[id??'']?.label??'Loading subject…';
  };
  const filtered=sorted.filter(r=>matchesPipelineView({
    ...r,owner_profile_id:'owner_profile_id' in r?r.owner_profile_id:null,
  },labelOf(r),{search_text:searchText,stage_id:stageFilter||null,attention,owner_filter:ownerFilter},userId??''));
  const visibleFields= p?cardFieldLabels(p,fields.data??[]):[];
  const sortOptions=p?availableSortFields(p,fields.data??[]):[];
  const missingCount=sorted.filter(r=>p?.subject_type==='organization'&&((p.source_mode==='connected'?(r as ConnectedPipelineCard).primaryContact:subjects.data?.[(r as CrmPipelineRecord).organization_id??'']?.primaryContact)==='Primary contact needs review')).length;
  if(!currentTenantId)return <p className="p-6">Select your CRM tenant to view pipelines.</p>;
  return <div className="space-y-5 p-2 md:p-4">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h1 className="text-3xl font-bold">Pipelines</h1>
        <p className="text-sm text-muted-foreground">Configurable relationship workflows. Existing clinical, clinician and BTY statuses are maintained in their original systems.</p></div>
      <Button asChild variant="outline"><Link to="/crm/business-development/opportunities">Legacy BTY opportunities</Link></Button>
    </div>
    {list.isError&&<p role="alert" className="text-destructive">Cannot load pipelines: {list.error.message}</p>}
    {actionError&&<p role="alert" className="rounded border border-destructive p-3 text-destructive">{actionError}</p>}
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[210px] space-y-1"><Label htmlFor="pipeline-choice">Pipeline</Label>
        <select id="pipeline-choice" className="w-full rounded-md border bg-background p-2" value={p?.id??''}
          onChange={e=>{setSelected(e.target.value);setTab('board');setSortKey('updated_at');
            setViewMode('board');setSearchText('');setStageFilter('');setAttention('all');setOwnerFilter('all');setActiveSavedView('');
            setRecordLimit(200);setSelectedRecords([]);setBulkStage('');setFindSubject('');setEnrollId('');}}>
          {(list.data??[]).map(x=><option key={x.id} value={x.id}>{x.name} ({x.subject_type})</option>)}
        </select></div>
      {p&&<><Button size="sm" variant={tab==='board'?'default':'outline'} onClick={()=>setTab('board')}>Board</Button>
        {admin&&<Button size="sm" variant={tab==='settings'?'default':'outline'} onClick={()=>setTab('settings')}>Pipeline settings</Button>}</>}
    </div>
    {admin&&<Card><CardHeader><CardTitle>Create pipeline</CardTitle><CardDescription>Uses the same configurable engine for every personal or organization workflow. Source-connected workflows require a separately verified adapter.</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1 space-y-1"><Label htmlFor="new-pipeline-name">Name</Label><Input id="new-pipeline-name" value={newName} maxLength={120} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Community Partnerships"/></div>
        <div className="space-y-1"><Label htmlFor="new-pipeline-type">Record type</Label>
          <select id="new-pipeline-type" className="rounded border bg-background p-2" value={newSubject} onChange={e=>setNewSubject(e.target.value as PipelineSubject)}>
            <option value="person">Personal</option><option value="organization">Organization</option>
          </select></div>
        <Button disabled={busy||!newName.trim()} onClick={()=>act(async()=>{
          const result=await pipelinesRepository.create(currentTenantId,userId,newName,newSubject);
          setSelected(result.id);setNewName('');setTab('settings');
        })}>Create pipeline</Button>
      </CardContent></Card>}
    {!p&&!list.isLoading&&<p className="rounded border p-4 text-muted-foreground">No pipelines configured yet. Create your first pipeline above. Existing records are not automatically converted.</p>}
    {p&&tab==='settings'&&admin&&<section className="space-y-5">
      <Card><CardHeader><CardTitle>{p.name} · Settings</CardTitle><CardDescription>
        {p.subject_type==='organization'?'Organization name and its one global primary contact':'Person name'} always appear on every card; these cannot be removed.
        {p.source_mode==='connected'?' This pipeline mirrors an existing source workflow.':''}</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">Required card identity: <strong>{mandatoryCardFields(p.subject_type).join(' + ')}</strong></p>
          <div className="space-y-1"><Label htmlFor="rename-pipeline">Rename pipeline</Label>
            <PipelineRename key={p.id} p={p} save={act} busy={busy}/></div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Stages</CardTitle><CardDescription>Stage names are configuration data, not application code. Connected workflows will map to the existing authoritative statuses.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {(stages.data??[]).map(s=><p key={s.id} className="rounded border px-3 py-2">{s.position+1}. {s.name} {s.is_terminal?'· Terminal':''}</p>)}
          {p.source_mode==='manual'&&<div className="space-y-2 rounded border p-3">
            <p className="text-sm font-semibold">Transition rules</p>
            <p className="text-xs text-muted-foreground">By default, manual cards may move between non-terminal stages. Leaving a terminal stage requires an explicit Allow rule. Deny can block any specific move.</p>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Rule source stage" className="rounded border bg-background p-2" value={fromStage} onChange={e=>setFromStage(e.target.value)}>
                <option value="">From stage</option>{(stages.data??[]).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <select aria-label="Rule destination stage" className="rounded border bg-background p-2" value={toStage} onChange={e=>setToStage(e.target.value)}>
                <option value="">To stage</option>{(stages.data??[]).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <select aria-label="Rule decision" className="rounded border bg-background p-2" value={ruleAllowed?'allow':'deny'} onChange={e=>setRuleAllowed(e.target.value==='allow')}>
                <option value="allow">Allow</option><option value="deny">Deny</option>
              </select>
              <Button size="sm" disabled={busy||!fromStage||!toStage||fromStage===toStage}
                onClick={()=>act(()=>pipelinesRepository.setStageRule(p,fromStage,toStage,ruleAllowed))}>Save rule</Button>
            </div>
            {(rules.data??[]).map(rule=><div key={rule.from_stage_id+rule.to_stage_id} className="flex flex-wrap items-center gap-2 text-sm">
              <span>{stages.data?.find(x=>x.id===rule.from_stage_id)?.name} → {stages.data?.find(x=>x.id===rule.to_stage_id)?.name}:
                <strong> {rule.is_allowed?'Allowed':'Blocked'}</strong></span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={()=>act(()=>pipelinesRepository.removeStageRule(rule))}>Remove rule</Button>
            </div>)}
          </div>}
          {p.source_mode==='manual'&&<div className="flex gap-2"><Input aria-label="New stage name" placeholder="Add a stage" value={stageName} maxLength={100} onChange={e=>setStageName(e.target.value)}/>
            <Button disabled={busy||!stageName.trim()} onClick={()=>act(async()=>{await pipelinesRepository.addStage(p,stageName,stages.data?.length??0);setStageName('');})}>Add stage</Button></div>}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Custom fields and card layout</CardTitle><CardDescription>Enable fields on cards independently of the Sort by dropdown. Select and multiselect fields accept comma-separated options.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {(fields.data??[]).map(f=><div className="flex flex-wrap items-center gap-3 rounded border p-3" key={f.id}>
            <div className="min-w-[130px] flex-1"><strong>{f.label}</strong><p className="text-xs text-muted-foreground">{f.field_key} · {f.field_type}</p></div>
            <label className="flex gap-1 text-sm"><input type="checkbox" checked={f.show_on_card&&p.card_field_keys.includes(f.field_key)} disabled={busy}
              onChange={e=>act(async()=>{
                await pipelinesRepository.updateField(f,{show_on_card:e.target.checked});
                await pipelinesRepository.update(p,{card_field_keys:e.target.checked?[...new Set([...p.card_field_keys,f.field_key])]:p.card_field_keys.filter(k=>k!==f.field_key)});
              })}/> Card</label>
            <label className="flex gap-1 text-sm"><input type="checkbox" checked={f.allow_sort&&p.sort_field_keys.includes(f.field_key)} disabled={busy}
              onChange={e=>act(async()=>{
                await pipelinesRepository.updateField(f,{allow_sort:e.target.checked});
                await pipelinesRepository.update(p,{sort_field_keys:e.target.checked?[...new Set([...p.sort_field_keys,f.field_key])]:p.sort_field_keys.filter(k=>k!==f.field_key)});
              })}/> Sort by</label>
          </div>)}
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_auto]">
            <Input aria-label="New field label" placeholder="Field name" value={fieldLabel} onChange={e=>setFieldLabel(e.target.value)}/>
            <select aria-label="Field type" className="rounded border bg-background p-2" value={fieldType} onChange={e=>setFieldType(e.target.value as PipelineFieldType)}>{fieldTypes.map(t=><option key={t} value={t}>{t}</option>)}</select>
            <Input aria-label="Dropdown options" placeholder="Dropdown options (optional)" value={fieldOptions} onChange={e=>setFieldOptions(e.target.value)}/>
            <Button disabled={busy||!normalizePipelineFieldKey(fieldLabel)} onClick={()=>act(async()=>{
              await pipelinesRepository.addField(p,{label:fieldLabel,fieldKey:normalizePipelineFieldKey(fieldLabel),type:fieldType,options:fieldOptions.split(',').map(x=>x.trim()).filter(Boolean),position:fields.data?.length??0});
              setFieldLabel('');setFieldOptions('');
            })}>Add field</Button>
          </div>
        </CardContent>
      </Card>
    </section>}
    {p&&tab==='board'&&<section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="pipeline-view-mode">View</Label>
          <select id="pipeline-view-mode" className="rounded border bg-background p-2" value={viewMode}
            onChange={e=>setViewMode(e.target.value as PipelineViewMode)}>
            <option value="board">Kanban board</option><option value="list">List</option>
          </select></div>
        <div className="space-y-1"><Label htmlFor="pipeline-sort">Sort by</Label>
          <select id="pipeline-sort" className="rounded border bg-background p-2"
            value={sortOptions.some(f=>f.key===sortKey)?sortKey:sortOptions[0]?.key??'updated_at'}
            onChange={e=>setSortKey(e.target.value)}>
            {sortOptions.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}
          </select></div>
        <div className="space-y-1"><Label htmlFor="pipeline-search">Search</Label>
          <Input id="pipeline-search" value={searchText} maxLength={200} onChange={e=>setSearchText(e.target.value)}
            placeholder="Search name or card fields"/></div>
        <div className="space-y-1"><Label htmlFor="pipeline-stage-filter">Stage</Label>
          <select id="pipeline-stage-filter" className="rounded border bg-background p-2" value={stageFilter}
            onChange={e=>setStageFilter(e.target.value)}>
            <option value="">All stages</option>{(stages.data??[]).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
          </select></div>
        <div className="space-y-1"><Label htmlFor="pipeline-attention">Action</Label>
          <select id="pipeline-attention" className="rounded border bg-background p-2" value={attention}
            onChange={e=>setAttention(e.target.value as AttentionFilter)}>
            <option value="all">All</option><option value="overdue">Overdue</option>
            <option value="no_next_action">No next action</option>
          </select></div>
        {p.source_mode==='manual'&&<div className="space-y-1"><Label htmlFor="pipeline-owner-filter">Owner</Label>
          <select id="pipeline-owner-filter" className="rounded border bg-background p-2" value={ownerFilter}
            onChange={e=>setOwnerFilter(e.target.value as OwnerFilter)}>
            <option value="all">All owners</option><option value="mine">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select></div>}
        <Badge variant="secondary">{p.subject_type==='organization'?'Organization':'Personal'}</Badge>
        <Badge variant="outline">{filtered.length} of {sorted.length} loaded</Badge>
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded border p-3">
        <div className="space-y-1"><Label htmlFor="pipeline-saved-view">Saved views</Label>
          <select id="pipeline-saved-view" className="rounded border bg-background p-2" value={activeSavedView}
            onChange={e=>{
              const id=e.target.value;setActiveSavedView(id);
              const v=saved.data?.find(x=>x.id===id);if(!v)return;
              setViewMode(v.view_mode);setSortKey(v.sort_key);setSearchText(v.search_text);
              setStageFilter(v.stage_id??'');setAttention(v.attention);setOwnerFilter(v.owner_filter);
            }}>
            <option value="">Current / unsaved filters</option>
            {(saved.data??[]).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
          </select></div>
        <Input aria-label="Save view as" className="max-w-56" maxLength={100}
          value={saveName} placeholder="New view name" onChange={e=>setSaveName(e.target.value)}/>
        <Button size="sm" disabled={busy||!saveName.trim()||!userId} onClick={()=>act(async()=>{
          await pipelinesRepository.saveView(p,userId!,{
            name:saveName.trim(),view_mode:viewMode,sort_key:sortKey,search_text:searchText,
            stage_id:stageFilter||null,attention,owner_filter:ownerFilter,
          });setSaveName('');
        })}>Save current view</Button>
        {activeSavedView&&<Button size="sm" variant="outline" disabled={busy}
          onClick={()=>act(async()=>{
            const v=saved.data?.find(x=>x.id===activeSavedView);if(!v)return;
            await pipelinesRepository.updateSavedView(v,{
              view_mode:viewMode,sort_key:sortKey,search_text:searchText,
              stage_id:stageFilter||null,attention,owner_filter:ownerFilter,
            });
          })}>Update saved view</Button>}
        {activeSavedView&&<Button size="sm" variant="outline" disabled={busy}
          onClick={()=>act(async()=>{
            const v=saved.data?.find(x=>x.id===activeSavedView);if(!v)return;
            await pipelinesRepository.deleteView(v);setActiveSavedView('');
          })}>Delete saved view</Button>}
      </div>
      {p.source_mode==='connected'&&<p className="rounded border p-3 text-sm">Live source-connected board: stages are read from the authoritative system, not copied or editable here. To change a stage, use the existing record workflow.</p>}
      {connected.isError&&<p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">Source records could not be loaded with your current permissions: {connected.error.message}</p>}
      {p.source_mode==='manual'&&records.data?.length===recordLimit&&recordLimit<2000&&
        <Button variant="outline" onClick={()=>setRecordLimit(x=>Math.min(x+200,2000))}>Load 200 more records</Button>}
      {p.source_mode==='manual'&&records.data?.length===2000&&<p role="status" className="text-sm text-amber-700">
        First 2,000 records loaded. Server-side pagination is required for larger pipelines.</p>}
      {missingCount>0&&<p role="alert" className="text-destructive">{missingCount} organizations need primary-contact review.</p>}
      {sourceBinding.isError&&<p role="alert" className="text-destructive">Source binding unavailable: {sourceBinding.error.message}</p>}
      {giving.isError&&<p role="alert" className="text-destructive">Verified donation enrichment could not be loaded: {giving.error.message}</p>}
      {sourceBinding.data==='donor_giving'&&<p className="rounded border p-3 text-sm">
        Donor relationship stages remain manually managed. Verified giving totals, donor type and last donation are read live from your existing donor database when a donor is linked to the CRM person; temporary test donors are excluded.
      </p>}
      {p.source_mode==='manual'&&capabilities.mutate&&(stages.data?.length??0)>0&&<Card><CardContent className="grid gap-2 pt-4 md:grid-cols-[1fr_2fr_auto]">
        <Input aria-label="Find CRM person or organization" placeholder="Search existing CRM records" value={findSubject} onChange={e=>{setFindSubject(e.target.value);setEnrollId('');}}/>
        <select aria-label="Record to add" className="rounded border bg-background p-2" value={enrollId} onChange={e=>setEnrollId(e.target.value)}>
          <option value="">Choose {p.subject_type==='person'?'a person':'an organization'}</option>
          {(candidates.data??[]).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        {p.subject_type==='person'&&<select aria-label="Optional associated organization" className="rounded border bg-background p-2" value={associatedOrgId} onChange={e=>setAssociatedOrgId(e.target.value)}>
          <option value="">No associated organization</option>
          {(relatedOrganizations.data??[]).map(org=><option key={org.id} value={org.id}>{org.name}</option>)}
        </select>}
        <Button disabled={busy||!enrollId} onClick={()=>act(async()=>{
          await pipelinesRepository.enroll(p,stages.data![0].id,enrollId,associatedOrgId||null);setEnrollId('');setAssociatedOrgId('');
        })}>Add to pipeline</Button>
      </CardContent></Card>}
      {(sourceBinding.data==='institutional_recruiting'||sourceBinding.data==='va_facilities')&&p.source_mode==='manual'&&
        <ResearchSourceReview pipeline={p} kind={sourceBinding.data} canEdit={capabilities.mutate}/>}
      {p.source_mode==='manual'&&viewMode==='list'&&capabilities.mutate&&<div className="flex flex-wrap items-center gap-2 rounded border p-2">
        <Badge variant="outline">{selectedRecords.length} selected (limit 20)</Badge>
        <select aria-label="Bulk target stage" className="rounded border bg-background p-2" value={bulkStage} onChange={e=>setBulkStage(e.target.value)}>
          <option value="">Bulk move to stage</option>{(stages.data??[]).map(stage=><option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </select>
        <Button size="sm" disabled={busy||!bulkStage||selectedRecords.length===0}
          onClick={()=>act(async()=>{
            const moving=(records.data??[]).filter(r=>selectedRecords.includes(r.id));
            for(const record of moving){
              if(canMovePipelineCard(record.stage_id,bulkStage,stages.data??[],rules.data??[])){
                await pipelinesRepository.move(record,bulkStage);
              } else throw new Error('A selected record has a blocked stage transition. No further records were moved.');
            }
            setSelectedRecords([]);
          })}>Move selected (up to 20)</Button>
      </div>}
      {viewMode==='list'&&<div className="overflow-x-auto rounded border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted text-left"><tr>
            {p.source_mode==='manual'&&<th className="p-3">Select</th>}
            <th className="p-3">{p.subject_type==='person'?'Person':'Organization'}</th>
            {p.subject_type==='organization'&&<th className="p-3">Global primary</th>}
            <th className="p-3">Stage</th><th className="p-3">Next action</th>
            {visibleFields.map(v=><th key={v.id} className="p-3">{v.label}</th>)}
          </tr></thead>
          <tbody>{filtered.map(row=>{
            const source=p.source_mode==='connected'?row as ConnectedPipelineCard:null;
            const manual=source?null:row as CrmPipelineRecord;
            const contact=p.subject_type==='organization'
              ?(source?.primaryContact??subjects.data?.[manual?.organization_id??'']?.primaryContact??'Needs review')
              :null;
            return <tr key={row.id} className="border-t">
              {manual&&<td className="p-3"><input type="checkbox" aria-label={'Select '+labelOf(row)}
                checked={selectedRecords.includes(row.id)}
                disabled={!capabilities.mutate||(!selectedRecords.includes(row.id)&&selectedRecords.length>=20)}
                onChange={e=>setSelectedRecords(xs=>e.target.checked?[...xs,row.id]:xs.filter(x=>x!==row.id))}/></td>}
              <td className="p-3 font-medium">{labelOf(row)}
                {source?.sourceUrl&&<span className="block">
                  {source.sourceUrl.startsWith('https://')
                    ?<a className="text-xs underline" href={source.sourceUrl} target="_blank" rel="noopener noreferrer">Open source</a>
                    :<Link className="text-xs underline" to={source.sourceUrl}>Open source</Link>}
                </span>}</td>
              {p.subject_type==='organization'&&<td className="p-3">{contact}</td>}
              <td className="p-3">{stages.data?.find(stage=>stage.id===row.stage_id)?.name??'Unknown stage'}</td>
              <td className="p-3">{row.next_action??'—'}</td>
              {visibleFields.map(field=><td key={field.id} className="p-3">{String(row.field_values[field.field_key]??'—')}</td>)}
            </tr>;
          })}</tbody>
        </table>
        {filtered.length===0&&<p className="p-4 text-sm text-muted-foreground">No records match these filters.</p>}
      </div>}
      {viewMode==='board'&&<PipelineDragContext enabled={p.source_mode==='manual'&&capabilities.mutate&&!busy}
        onMove={(recordId,stageId)=>{
          const row=records.data?.find(r=>r.id===recordId);
          if(!row||!canMovePipelineCard(row.stage_id,stageId,stages.data??[],rules.data??[])){
            setActionError('That stage move is not permitted by this pipeline’s transition rules.');return;
          }
          void act(()=>pipelinesRepository.move(row,stageId));
        }}>
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(stages.data??[]).filter(stage=>!stageFilter||stage.id===stageFilter).map(stage=><KanbanStageDrop key={stage.id} id={stage.id}
          enabled={p.source_mode==='manual'&&capabilities.mutate}>
          <Card className="min-w-0">
          <CardHeader><CardTitle className="text-base">{stage.name}</CardTitle><CardDescription>{filtered.filter(r=>r.stage_id===stage.id).length} records</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {filtered.filter(r=>r.stage_id===stage.id).map(record=>{
              const source=p.source_mode==='connected'?record as ConnectedPipelineCard:null;
              const manual=source?null:record as CrmPipelineRecord;
              const subjectId=manual?(p.subject_type==='person'?manual.contact_id:manual.organization_id):null;
              const identity=subjects.data?.[subjectId??''];
              return <KanbanRecordDrag key={record.id} id={record.id}
                enabled={p.source_mode==='manual'&&capabilities.mutate&&!busy}>
                <p className="font-medium">{source?.displayName??identity?.label??'Loading subject…'}</p>
                {p.subject_type==='organization'&&<p className="text-sm text-muted-foreground">Primary: {source?.primaryContact??identity?.primaryContact??'Loading…'}</p>}
                {manual?.associated_organization_id&&<p className="text-xs text-muted-foreground">Organization: {relatedOrganizations.data?.find(org=>org.id===manual.associated_organization_id)?.name??'Linked organization'}</p>}
                {source?.sourceUrl&&(source.sourceUrl.startsWith("https://")
                  ?<a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline">Open source workspace</a>
                  :<Link to={source.sourceUrl} className="text-xs underline">Open source record</Link>)}
                {visibleFields.map(f=><p key={f.id} className="text-sm">{f.label}: {String(record.field_values[f.field_key]??'—')}</p>)}
                {record.next_action&&<p className="text-xs text-muted-foreground">Next: {record.next_action}</p>}
                {manual&&capabilities.mutate&&<PipelineActionEditor key={record.id+':actions:'+(manual.version??0)}
                  record={manual} userId={userId??''} busy={busy} save={act}/>}
                {p.source_mode==='manual'&&capabilities.mutate&&(fields.data?.length??0)>0&&
                  <PipelineValueEditor key={record.id+':'+(manual?.version??0)} record={manual!} fields={fields.data??[]}
                    busy={busy} save={act}/>}
                {manual&&capabilities.mutate&&<select aria-label={'Move '+(identity?.label??'record')} className="w-full rounded border bg-background p-2 text-xs" value={record.stage_id}
                  onChange={e=>act(()=>pipelinesRepository.move(manual,e.target.value))}>
                  {(stages.data??[]).map(s=><option key={s.id} value={s.id}
                    disabled={s.id!==record.stage_id&&!canMovePipelineCard(record.stage_id,s.id,stages.data??[],rules.data??[])}>{s.name}</option>)}
                </select>}
              </KanbanRecordDrag>;
            })}
          </CardContent></Card></KanbanStageDrop>)}
      </div>
      </PipelineDragContext>}
      {!stages.data?.length&&<p className="text-muted-foreground">Configure your first stage to start using this pipeline.</p>}
    </section>}
  </div>;
}
function PipelineRename({p,save,busy}:{p:CrmPipeline;save:(fn:()=>Promise<unknown>)=>void;busy:boolean}){
  const [name,setName]=useState(p.name);
  return <div className="flex gap-2"><Input value={name} onChange={e=>setName(e.target.value)} maxLength={120}/>
    <Button disabled={busy||!name.trim()||name===p.name} onClick={()=>save(()=>pipelinesRepository.update(p,{name:name.trim()}))}>Save name</Button></div>;
}

function PipelineValueEditor({record,fields,busy,save}:{
  record:CrmPipelineRecord; fields:CrmPipelineField[]; busy:boolean;
  save:(action:()=>Promise<unknown>)=>void;
}){
  const [open,setOpen]=useState(false);
  const [values,setValues]=useState<Record<string,unknown>>({...record.field_values});
  return <>
    <Button size="sm" variant="outline" disabled={busy} onClick={()=>setOpen(v=>!v)}>
      {open?'Hide fields':'Edit custom fields'}
    </Button>
    {open&&<div className="space-y-3 border-t pt-3">
      {fields.map(field=><label key={field.id} className="block space-y-1 text-xs">
        <span>{field.label}{field.required?' *':''}</span>
        {field.field_type==='boolean'
          ? <input type="checkbox" checked={values[field.field_key]===true} onChange={e=>setValues(v=>({...v,[field.field_key]:e.target.checked}))}/>
          : field.field_type==='select'
            ? <select className="w-full rounded border bg-background p-2" value={String(values[field.field_key]??'')}
                onChange={e=>setValues(v=>({...v,[field.field_key]:e.target.value||null}))}>
                <option value="">Select</option>
                {field.options.map(option=><option key={option} value={option}>{option}</option>)}
              </select>
            : <Input type={field.field_type==='number'||field.field_type==='currency'?'number':field.field_type==='date'?'date':field.field_type==='datetime'?'datetime-local':field.field_type==='url'?'url':'text'}
                value={Array.isArray(values[field.field_key])?(values[field.field_key] as string[]).join(', '):String(values[field.field_key]??'')}
                onChange={e=>setValues(v=>({...v,[field.field_key]:
                  field.field_type==='number'||field.field_type==='currency'?(e.target.value===''?null:Number(e.target.value))
                  :field.field_type==='multiselect'?e.target.value.split(',').map(x=>x.trim()).filter(Boolean)
                  :e.target.value||null,
                }))}/>}
      </label>)}
      <Button size="sm" disabled={busy||fields.some(f=>f.required&&(values[f.field_key]==null||values[f.field_key]===''))}
        onClick={()=>save(async()=>{await pipelinesRepository.updateValues(record,values);setOpen(false);})}>Save custom fields</Button>
    </div>}
  </>;
}
