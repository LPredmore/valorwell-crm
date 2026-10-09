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
import { listPipelineSubjects,getPipelineCardSubjects } from '@/repositories/supabase/pipeline-subjects';
import {
  availableSortFields,builtinSortFields,cardFieldLabels,comparePipelineRecords,
  mandatoryCardFields,normalizePipelineFieldKey,
  type CrmPipeline,type CrmPipelineField,type CrmPipelineRecord,type PipelineFieldType,type PipelineSubject,
} from '@/domain/pipelines/models';

const fieldTypes:PipelineFieldType[]=['text','number','currency','date','datetime','boolean','url','select','multiselect'];
function usePipeData(p:CrmPipeline|null) {
  const enabled=!!p;
  const stages=useQuery({queryKey:['pipeline-stages',p?.id],queryFn:()=>pipelinesRepository.stages(p!),enabled,retry:false});
  const fields=useQuery({queryKey:['pipeline-fields',p?.id],queryFn:()=>pipelinesRepository.fields(p!),enabled,retry:false});
  const records=useQuery({queryKey:['pipeline-records',p?.id],queryFn:()=>pipelinesRepository.records(p!),enabled,retry:false});
  const subjects=useQuery({queryKey:['pipeline-card-subjects',p?.id,records.dataUpdatedAt],queryFn:()=>getPipelineCardSubjects(p!,records.data??[]),enabled:enabled&&!!records.data,retry:false});
  return {stages,fields,records,subjects};
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
  const [sortKey,setSortKey]=useState('updated_at');
  const list=useQuery({queryKey:['crm-pipelines',currentTenantId],queryFn:()=>pipelinesRepository.list(currentTenantId!),enabled:!!currentTenantId,retry:false});
  const p=list.data?.find(x=>x.id===selected)??list.data?.[0]??null;
  const {stages,fields,records,subjects}=usePipeData(p);
  const candidates=useQuery({queryKey:['pipeline-subject-picker',p?.id,findSubject],queryFn:()=>listPipelineSubjects(p!,findSubject),enabled:!!p&&p.source_mode==='manual',retry:false});
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
    ]);}
    catch(e){setActionError(e instanceof Error?e.message:'Action failed');}
  };
  const sorted=useMemo(()=>[...(records.data??[])].sort((a,b)=>comparePipelineRecords(a,b,sortKey)),
    [records.data,sortKey]);
  const visibleFields= p?cardFieldLabels(p,fields.data??[]):[];
  const sortOptions=p?availableSortFields(p,fields.data??[]):[];
  const missingCount=sorted.filter(r=>p?.subject_type==='organization'&&subjects.data?.[r.organization_id??'']?.primaryContact==='Primary contact needs review').length;
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
          onChange={e=>{setSelected(e.target.value);setTab('board');setSortKey('updated_at');setFindSubject('');setEnrollId('');}}>
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
            <PipelineRename p={p} save={act} busy={busy}/></div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Stages</CardTitle><CardDescription>Stage names are configuration data, not application code. Connected workflows will map to the existing authoritative statuses.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {(stages.data??[]).map(s=><p key={s.id} className="rounded border px-3 py-2">{s.position+1}. {s.name} {s.is_terminal?'· Terminal':''}</p>)}
          <div className="flex gap-2"><Input aria-label="New stage name" placeholder="Add a stage" value={stageName} maxLength={100} onChange={e=>setStageName(e.target.value)}/>
            <Button disabled={busy||!stageName.trim()} onClick={()=>act(async()=>{await pipelinesRepository.addStage(p,stageName,stages.data?.length??0);setStageName('');})}>Add stage</Button></div>
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
        <div className="space-y-1"><Label htmlFor="pipeline-sort">Sort by</Label><select id="pipeline-sort" value={sortOptions.some(s=>s.key===sortKey)?sortKey:sortOptions[0]?.key??'updated_at'}
          onChange={e=>setSortKey(e.target.value)} className="rounded border bg-background p-2">{sortOptions.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
        <Badge variant="secondary">{p.subject_type==='organization'?'Organization':'Personal'} pipeline</Badge>
        <Badge variant="outline">{records.data?.length??0} records loaded</Badge>
      </div>
      {p.source_mode==='connected'&&<p className="rounded border p-3 text-sm">Connected source adapter is not configured yet; no source statuses can be changed from this board.</p>}
      {records.data?.length===500&&<p role="status" className="text-sm text-amber-700">Showing up to 500 records. Pagination will be included in the next board phase.</p>}
      {missingCount>0&&<p role="alert" className="text-destructive">{missingCount} organizations need primary-contact review.</p>}
      {p.source_mode==='manual'&&capabilities.mutate&&(stages.data?.length??0)>0&&<Card><CardContent className="grid gap-2 pt-4 md:grid-cols-[1fr_2fr_auto]">
        <Input aria-label="Find CRM person or organization" placeholder="Search existing CRM records" value={findSubject} onChange={e=>{setFindSubject(e.target.value);setEnrollId('');}}/>
        <select aria-label="Record to add" className="rounded border bg-background p-2" value={enrollId} onChange={e=>setEnrollId(e.target.value)}>
          <option value="">Choose {p.subject_type==='person'?'a person':'an organization'}</option>
          {(candidates.data??[]).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <Button disabled={busy||!enrollId} onClick={()=>act(async()=>{
          await pipelinesRepository.enroll(p,stages.data![0].id,enrollId);setEnrollId('');
        })}>Add to pipeline</Button>
      </CardContent></Card>}
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(stages.data??[]).map(stage=><Card key={stage.id} className="min-w-0">
          <CardHeader><CardTitle className="text-base">{stage.name}</CardTitle><CardDescription>{sorted.filter(r=>r.stage_id===stage.id).length} records</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {sorted.filter(r=>r.stage_id===stage.id).map(record=>{
              const subjectId=p.subject_type==='person'?record.contact_id:record.organization_id;
              const identity=subjects.data?.[subjectId??''];
              return <div key={record.id} className="rounded-lg border p-3 space-y-2">
                <p className="font-medium">{identity?.label??'Loading subject…'}</p>
                {p.subject_type==='organization'&&<p className="text-sm text-muted-foreground">Primary: {identity?.primaryContact??'Loading…'}</p>}
                {visibleFields.map(f=><p key={f.id} className="text-sm">{f.label}: {String(record.field_values[f.field_key]??'—')}</p>)}
                {record.next_action&&<p className="text-xs text-muted-foreground">Next: {record.next_action}</p>}
                {p.source_mode==='manual'&&capabilities.mutate&&(fields.data?.length??0)>0&&
                  <PipelineValueEditor key={record.id+':'+record.version} record={record} fields={fields.data??[]}
                    busy={busy} save={act}/>}
                {p.source_mode==='manual'&&capabilities.mutate&&<select aria-label={'Move '+(identity?.label??'record')} className="w-full rounded border bg-background p-2 text-xs" value={record.stage_id}
                  onChange={e=>act(()=>pipelinesRepository.move(record,e.target.value))}>
                  {(stages.data??[]).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>}
              </div>;
            })}
          </CardContent></Card>)}
      </div>
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
