import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {Label} from '@/components/ui/label';
import {useCrmAuth} from '@/hooks/crm/useCrmAuth';
import {useTasks} from '@/hooks/canonical/useCrmData';
import {useRelationshipCapability} from '@/hooks/relationships/useRelationshipCapabilities';
import {pipelinesRepository} from '@/repositories/supabase/pipelines';
import {getManualPipelineMetrics,pipelineMetricsTotals} from '@/repositories/supabase/pipeline-metrics';
import {getRecruitmentPreview} from '@/repositories/supabase/recruitment-review';
import {dataProvider} from '@/services/dataProvider';

export default function WorkspaceDashboardPage(){
  const {currentTenantId,userId,crmRole}=useCrmAuth();
  return <WorkspaceDashboard key={`${currentTenantId}:${userId}:${crmRole}`}/>;
}
function WorkspaceDashboard(){
  const {currentTenantId,userId,crmRole,isAuthenticated}=useCrmAuth();
  const enabled=isAuthenticated&&!!currentTenantId;
  const [selected,setSelected]=useState('');
  const tasks=useTasks({view:'my',page:1,pageSize:5});
  const repliesCapability=useRelationshipCapability('replies');
  const replies=useQuery({
    queryKey:['workspace-open-replies',currentTenantId,userId,crmRole],
    queryFn:()=>dataProvider.relationships.listReplies({statuses:['new','needs_action','in_progress'],page:1,pageSize:1}),
    enabled:enabled&&repliesCapability.capability?.available===true,retry:false,
  });
  const recruitment=useQuery({
    queryKey:['recruitment-campaign-preview',currentTenantId,userId,crmRole],
    queryFn:()=>getRecruitmentPreview(currentTenantId!),enabled,retry:false,
  });
  const pipelines=useQuery({
    queryKey:['crm-pipelines',currentTenantId,userId,crmRole],
    queryFn:()=>pipelinesRepository.list(currentTenantId!),enabled,retry:false,
  });
  const manual=pipelines.isError?[]:pipelines.data?.filter(item=>item.source_mode==='manual')??[];
  const pipeline=manual.find(item=>item.id===selected)??manual[0];
  const stages=useQuery({queryKey:['pipeline-stages',pipeline?.id,currentTenantId,userId,crmRole],
    queryFn:()=>pipelinesRepository.stages(pipeline!),enabled:enabled&&!!pipeline,retry:false});
  const metrics=useQuery({queryKey:['crm-manual-pipeline-metrics',currentTenantId,pipeline?.id,userId,crmRole],
    queryFn:()=>getManualPipelineMetrics(pipeline!),enabled:enabled&&!!pipeline,retry:false});
  const totals=metrics.isSuccess&&!metrics.isError?pipelineMetricsTotals(metrics.data):null;
  if(!currentTenantId)return <p className="p-6">Select your CRM tenant to open the dashboard.</p>;
  return <div className="space-y-6 p-4 md:p-6">
    <div><h1 className="text-3xl font-bold">CRM dashboard</h1><p className="mt-2 text-muted-foreground">Your follow-ups, relationship replies and separate pipeline workspaces.</p></div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Summary title="Relationship replies" href="/crm/business-development/replies"
        value={repliesCapability.capability?.available&&replies.isSuccess&&!replies.isError?replies.data.total:null}
        detail="New, needs-action and in-progress replies"/>
      <Summary title="Recruitment review" href="/crm/recruitment/prospects?workflow=review"
        value={recruitment.isSuccess&&!recruitment.isError?recruitment.data.review:null} detail="Prospects awaiting review"/>
      <Card><CardHeader><CardTitle className="text-base">Beyond The Yellow</CardTitle><CardDescription>Review booking attempts and scheduling outcomes.</CardDescription></CardHeader>
        <CardContent><Button variant="outline" asChild><Link to="/crm/business-development/bty-scheduling-activity">Open scheduling activity</Link></Button></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Client operations</CardTitle><CardDescription>Open the protected client dashboard, intake and exceptions.</CardDescription></CardHeader>
        <CardContent><Button variant="outline" asChild><Link to="/crm/canonical">Open client operations</Link></Button></CardContent></Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>My follow-ups</CardTitle><CardDescription>Up to five tasks from My Tasks, ordered by due date. Open the queue to manage all loaded tasks.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {tasks.isPending&&<p role="status">Loading your tasks…</p>}
          {tasks.isError&&<div role="alert"><p>Tasks unavailable.</p><Button variant="outline" size="sm" onClick={()=>void tasks.refetch()}>Retry tasks</Button></div>}
          {tasks.isSuccess&&!tasks.isError&&<ul className="space-y-2">{tasks.data.slice(0,5).map(task=><li key={task.id} className="rounded border p-3 text-sm">
            <p className="font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{task.dueAt?new Date(task.dueAt).toLocaleString():'No due date'} · {task.status}</p>
          </li>)}</ul>}
          {tasks.isSuccess&&!tasks.isError&&!tasks.data.length&&<p className="text-sm text-muted-foreground">No tasks in My Tasks.</p>}
          <Button asChild variant="outline"><Link to="/crm/tasks?view=my">Open My Tasks</Link></Button>
        </CardContent></Card>
      <Card><CardHeader><CardTitle>Pipeline attention</CardTitle><CardDescription>Current totals for one manual pipeline at a time. Connected workflows retain their own source reports.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {pipelines.isPending&&<p role="status">Loading pipelines…</p>}
          {pipelines.isError&&<p role="alert">Pipeline list unavailable.</p>}
          {pipelines.isSuccess&&!manual.length&&<p className="text-sm text-muted-foreground">No active manual pipelines available.</p>}
          {!!manual.length&&<><Label htmlFor="dashboard-pipeline">Pipeline</Label><select id="dashboard-pipeline" className="w-full rounded border bg-background p-2 text-sm" value={pipeline?.id??''} onChange={event=>setSelected(event.target.value)}>
            {manual.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
            {metrics.isPending&&<p role="status">Loading pipeline totals…</p>}
            {metrics.isError&&<p role="alert">Pipeline totals unavailable.</p>}
            {totals&&<><dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-muted-foreground">Records</dt><dd>{totals.records}</dd></div>
              <div><dt className="text-muted-foreground">Overdue next actions</dt><dd>{totals.overdue}</dd></div>
              <div><dt className="text-muted-foreground">Missing next action</dt><dd>{totals.missingAction}</dd></div>
              <div><dt className="text-muted-foreground">Unassigned</dt><dd>{totals.unassigned}</dd></div>
            </dl>
            {stages.isSuccess&&!stages.isError&&<ul className="space-y-1 text-sm">{stages.data.map(stage=><li className="flex justify-between gap-2" key={stage.id}>
              <span>{stage.name}</span><span>{metrics.data?.find(row=>row.stage_id===stage.id)?.record_count??'Unavailable'}</span>
            </li>)}</ul>}</>}
            <Button variant="outline" asChild><Link to={`/crm/pipelines?pipeline=${pipeline!.id}`}>Open pipeline</Link></Button>
          </>}
        </CardContent></Card>
    </div>
    <Button variant="outline" asChild><Link to="/crm/communications">Open communications</Link></Button>
  </div>;
}
function Summary({title,value,detail,href}:{title:string;value:number|null;detail:string;href:string}){
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>{detail}</CardDescription></CardHeader>
    <CardContent><p className="mb-3 text-3xl font-semibold">{value??'—'}</p>{value===null&&<p className="mb-3 text-xs text-muted-foreground">Count unavailable or loading</p>}
      <Button asChild variant="outline"><Link to={href}>Open workspace</Link></Button></CardContent></Card>;
}
