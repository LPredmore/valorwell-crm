import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { pipelinesRepository } from '@/repositories/supabase/pipelines';
import { RelationshipOwnerName } from './RelationshipOwnerField';
import { RelationshipPagination } from './RelationshipWorkspacePrimitives';

type Subject = { contactId:string; organizationId?:never } | { organizationId:string; contactId?:never };

export function RelationshipPipelinePanel({ subject }: { subject:Subject }) {
  const { currentTenantId, userId, crmRole } = useCrmAuth();
  return <PipelineMemberships key={`${currentTenantId}:${userId}:${crmRole}:${subject.contactId??subject.organizationId}`} subject={subject} />;
}

function PipelineMemberships({ subject }: { subject:Subject }) {
  const { currentTenantId, userId, crmRole, isAuthenticated } = useCrmAuth();
  const [page,setPage]=useState(1);
  const records=useQuery({
    queryKey:['relationship-pipeline-records',currentTenantId,userId,crmRole,subject,page],
    queryFn:()=>pipelinesRepository.subjectRecordsPage(currentTenantId!,subject,page),
    enabled:isAuthenticated&&!!currentTenantId,retry:false,
  });
  return <Card>
    <CardHeader><CardTitle>Linked pipelines</CardTitle><CardDescription>
      Manual CRM pipeline records for this contact or organization, including related-organization links.
      Clinical and other source-owned workflows remain in their own systems.
    </CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {records.isPending&&<p role="status" className="text-sm text-muted-foreground">Loading linked pipelines…</p>}
      {records.isError&&<div role="alert" className="space-y-2"><p className="text-sm text-destructive">Linked pipelines could not be loaded.</p>
        <Button size="sm" variant="outline" onClick={()=>void records.refetch()}>Try again</Button></div>}
      {!records.isError&&records.data&&<>
        <p className="text-sm text-muted-foreground">{records.data.total} linked record{records.data.total===1?'':'s'}.</p>
        {!records.data.items.length&&<p className="text-sm text-muted-foreground">No linked manual pipeline records on this page.</p>}
        <ul className="space-y-2">{records.data.items.map(row=><li key={row.id} className="rounded border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{row.pipeline?.name??'Pipeline unavailable'}</p>
            {row.pipeline?.source_mode==='manual'&&!row.pipeline.archived_at&&<Button size="sm" variant="outline" asChild>
              <Link to={`/crm/pipelines?${new URLSearchParams({pipeline:row.pipeline_id,record:row.id})}`}>Open pipeline record</Link>
            </Button>}
          </div>
          <div className="mt-2 flex flex-wrap gap-2"><Badge variant="outline">{row.stageName??'Stage unavailable'}</Badge>
            {row.pipeline?.archived_at&&<Badge variant="secondary">Archived pipeline</Badge>}
            {row.association==='Related organization'&&<Badge variant="secondary">Related organization</Badge>}
          </div>
          <p className="mt-2 text-muted-foreground">Owner: <RelationshipOwnerName ownerId={row.owner_profile_id}/></p>
          <p className="mt-1 break-words">Next action: {row.next_action||'Not recorded'}</p>
          <p className="mt-1 text-xs text-muted-foreground">Due: {row.next_action_due_at?new Date(row.next_action_due_at).toLocaleString():'Not scheduled'}</p>
        </li>)}</ul>
        <RelationshipPagination page={page} pageSize={25} total={records.data.total} disabled={records.isFetching} onPageChange={setPage}/>
      </>}
    </CardContent>
  </Card>;
}
