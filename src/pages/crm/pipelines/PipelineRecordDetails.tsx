import {Link} from 'react-router-dom';
import {useCrmAuth} from '@/hooks/crm/useCrmAuth';
import {RelationshipTimelinePanel} from '@/components/crm/relationships/RelationshipTimelinePanel';
import {RelationshipTasksPanel} from '@/components/crm/relationships/RelationshipTasksPanel';
import {RelationshipOwnerName} from '@/components/crm/relationships/RelationshipOwnerField';
import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { CrmPipeline, CrmPipelineRecord, CrmPipelineStage } from '@/domain/pipelines/models';
import { buildPipelineRecordTimeline, getPipelineStageHistoryPage } from '@/repositories/supabase/pipeline-record-history';

function dateLabel(value: string | null): string {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Date unavailable';
}

/**
 * This is a read-only CRM relationship detail view. It never loads EHR notes,
 * clinical records or the hidden metadata of relationship interactions.
 */
export function PipelineRecordDetails({
  pipeline, record, stages, subjectName, ownerName, onClose,
}: {
  pipeline: CrmPipeline;
  record: CrmPipelineRecord;
  stages: CrmPipelineStage[];
  subjectName: string;
  ownerName: string;
  onClose: () => void;
}) {
  const {userId,crmRole}=useCrmAuth();
  const subject: {contactId:string;organizationId?:never}|{organizationId:string;contactId?:never}|null =
    pipeline.subject_type==='person'&&record.contact_id?{contactId:record.contact_id}
    :pipeline.subject_type==='organization'&&record.organization_id?{organizationId:record.organization_id}:null;
  const history = useInfiniteQuery({
    queryKey: ['crm-pipeline-record-history', pipeline.tenant_id, pipeline.id, record.id,userId,crmRole],
    initialPageParam:1,
    queryFn: ({pageParam}) => getPipelineStageHistoryPage(pipeline, record,pageParam),
    getNextPageParam:(last,pages)=>last.length===50?pages.length+1:undefined,
    retry: false,
  });
  const timeline = useMemo(
    () => history.data ? buildPipelineRecordTimeline({stages:[...new Map(history.data.pages.flat().map(row=>[row.id,row])).values()],interactions:[]}, stages) : [],
    [history.data, stages],
  );
  const currentStage = stages.find(stage => stage.id === record.stage_id)?.name ?? 'Unknown stage';

  return <div className="space-y-4"><Card aria-label="Pipeline record details" className="border-primary/30">
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-lg">{subjectName}</CardTitle>
          <CardDescription>Manual pipeline record details · {pipeline.name}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {subject&&<Button size="sm" variant="outline" asChild><Link to={subject.contactId
            ?`/crm/business-development/contacts/${subject.contactId}`
            :`/crm/business-development/organizations/${subject.organizationId}`}>Open relationship workspace</Link></Button>}
          <Button size="sm" variant="outline" onClick={onClose}>Close details</Button>
        </div>
      </div>
    </CardHeader>
    <CardContent className="space-y-5">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Current stage</dt><dd className="font-medium">{currentStage}</dd></div>
        <div><dt className="text-muted-foreground">Owner</dt><dd className="font-medium">{ownerName}</dd></div>
        <div><dt className="text-muted-foreground">Next action</dt><dd className="font-medium">{record.next_action || 'No next action'}</dd></div>
        <div><dt className="text-muted-foreground">Next action due</dt><dd className="font-medium">{dateLabel(record.next_action_due_at)}</dd></div>
        <div><dt className="text-muted-foreground">Created</dt><dd>{dateLabel(record.created_at)}</dd></div>
        <div><dt className="text-muted-foreground">Last modified</dt><dd>{dateLabel(record.updated_at)}</dd></div>
      </dl>
      {Object.keys(record.field_values).length > 0 && <section aria-label="Custom pipeline fields">
        <h3 className="mb-2 font-semibold">Custom fields</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {Object.entries(record.field_values).map(([key, value]) =>
            <div key={key}>
              <dt className="text-muted-foreground">{key.replace(/_/g, ' ')}</dt>
              <dd className="break-words">{value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
            </div>,
          )}
        </dl>
      </section>}
      <section aria-label="Record activity history">
        <h3 className="font-semibold">Stage history</h3>
        <p className="text-xs text-muted-foreground">
          Recorded stage changes for this CRM pipeline record, newest first.
          Load older stage events as needed. Relationship communications and follow-up tasks are shown below.
        </p>
        {history.isPending && <p role="status" className="mt-2 text-sm">Loading CRM history…</p>}
        {history.isError && <p role="alert" className="mt-2 text-sm text-destructive">
          Could not load CRM history: {history.error.message}
        </p>}
        {history.isError&&<Button variant="outline" size="sm" onClick={()=>void history.refetch()}>Retry stage history</Button>}
        {history.isSuccess && timeline.length === 0 && <p className="mt-2 text-sm text-muted-foreground">
          No recorded stage events for this pipeline record.
        </p>}
        {history.isSuccess && timeline.length > 0 && <ol className="mt-3 space-y-3">
          {timeline.map(item => <li key={item.id} className="rounded border p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium capitalize">{item.title}</span>
              <time className="text-xs text-muted-foreground" dateTime={item.occurredAt}>{dateLabel(item.occurredAt)}</time>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words">{item.detail}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">Recorded actor: {item.actorProfileId
              ?<><RelationshipOwnerName ownerId={item.actorProfileId}/> · {item.actorProfileId}</>:'Not recorded'}</p>
          </li>)}
        </ol>}
        {history.hasNextPage&&<Button className="mt-3" variant="outline" size="sm" disabled={history.isFetching} onClick={()=>void history.fetchNextPage()}>
          {history.isFetchingNextPage?'Loading…':'Load older stage events'}
        </Button>}
      </section>
    </CardContent>
  </Card>
    {subject&&<RelationshipTimelinePanel subject={subject}/>}
    {subject&&<RelationshipTasksPanel subject={subject}/>}
  </div>;
}
