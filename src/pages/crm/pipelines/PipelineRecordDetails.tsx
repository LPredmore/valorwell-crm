import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { CrmPipeline, CrmPipelineRecord, CrmPipelineStage } from '@/domain/pipelines/models';
import { buildPipelineRecordTimeline, getPipelineRecordHistory } from '@/repositories/supabase/pipeline-record-history';

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
  const history = useQuery({
    queryKey: ['crm-pipeline-record-history', pipeline.tenant_id, pipeline.id, record.id],
    queryFn: () => getPipelineRecordHistory(pipeline, record),
    retry: false,
  });
  const timeline = useMemo(
    () => history.data ? buildPipelineRecordTimeline(history.data, stages) : [],
    [history.data, stages],
  );
  const currentStage = stages.find(stage => stage.id === record.stage_id)?.name ?? 'Unknown stage';

  return <Card aria-label="Pipeline record details" className="border-primary/30">
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-lg">{subjectName}</CardTitle>
          <CardDescription>Manual pipeline record details · {pipeline.name}</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={onClose}>Close details</Button>
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
        <h3 className="font-semibold">Activity history</h3>
        <p className="text-xs text-muted-foreground">
          CRM stage changes for this record and relationship interactions for this person or organization.
          Up to 50 most recent entries from each source; not a complete audit export.
          Clinical records and external-source histories are not included.
        </p>
        {history.isPending && <p role="status" className="mt-2 text-sm">Loading CRM history…</p>}
        {history.isError && <p role="alert" className="mt-2 text-sm text-destructive">
          Could not load CRM history: {history.error.message}
        </p>}
        {history.isSuccess && timeline.length === 0 && <p className="mt-2 text-sm text-muted-foreground">
          No recorded CRM stage events or relationship interactions for this record.
        </p>}
        {history.isSuccess && timeline.length > 0 && <ol className="mt-3 space-y-3">
          {timeline.map(item => <li key={item.id} className="rounded border p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium capitalize">{item.title}</span>
              <time className="text-xs text-muted-foreground" dateTime={item.occurredAt}>{dateLabel(item.occurredAt)}</time>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words">{item.detail}</p>
          </li>)}
        </ol>}
      </section>
    </CardContent>
  </Card>;
}
