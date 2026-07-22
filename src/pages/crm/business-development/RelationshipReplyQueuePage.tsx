import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { relationshipReplyStatuses, type RelationshipReply, type RelationshipReplyStatus } from '@/domain/relationships/delivery-contracts';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

const labels: Record<RelationshipReplyStatus, string> = {
  new: 'New', needs_action: 'Needs action', in_progress: 'In progress', resolved: 'Resolved',
};

export default function RelationshipReplyQueuePage() {
  const queryClient = useQueryClient();
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('replies');
  const available = capability?.available === true;
  const [status, setStatus] = useState<RelationshipReplyStatus | ''>('');
  const [owner, setOwner] = useState('');
  const [unownedOnly, setUnownedOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { ownerId: string; status: RelationshipReplyStatus; followUpDueAt: string; reason: string }>>({});

  const replies = useQuery({
    queryKey: ['relationship-replies', status, owner, unownedOnly],
    queryFn: () => dataProvider.relationships.listReplies({ statuses: status ? [status] : undefined, ownerId: owner.trim() || undefined, unownedOnly, page: 1, pageSize: 100 }),
    enabled: available,
    retry: false,
  });

  const update = useMutation({
    mutationFn: ({ reply, draft }: { reply: RelationshipReply; draft: { ownerId: string; status: RelationshipReplyStatus; followUpDueAt: string; reason: string } }) => dataProvider.relationships.updateReply(reply.id, {
      expectedVersion: reply.version,
      ownerId: draft.ownerId.trim() || undefined,
      status: draft.status,
      followUpDueAt: draft.followUpDueAt ? new Date(draft.followUpDueAt).toISOString() : undefined,
      reason: draft.reason.trim() || undefined,
    }),
    onSuccess: async (reply) => {
      setDrafts((current) => { const next = { ...current }; delete next[reply.id]; return next; });
      await queryClient.invalidateQueries({ queryKey: ['relationship-replies'] });
    },
  });

  const edit = (reply: RelationshipReply) => drafts[reply.id] ?? {
    ownerId: reply.ownerId ?? '', status: reply.status,
    followUpDueAt: reply.followUpDueAt ? toLocalInput(reply.followUpDueAt) : '', reason: '',
  };
  const patch = (reply: RelationshipReply, values: Partial<ReturnType<typeof edit>>) => setDrafts((current) => ({ ...current, [reply.id]: { ...edit(reply), ...values } }));

  return <div className="space-y-6">
    <div><div className="mb-2 flex gap-2"><Badge variant="outline">Pass 12</Badge><Badge variant="secondary">Non-clinical replies</Badge></div><h1 className="text-3xl font-bold tracking-tight">Relationship reply queue</h1><p className="mt-2 max-w-3xl text-muted-foreground">Review inbound partnership and outreach replies. This queue is isolated from clinical, billing, appointment, and client communications.</p></div>
    <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />
    <Card><CardHeader><CardTitle>Queue filters</CardTitle><CardDescription>Unmatched provider messages never appear here; every reply must be linked to a canonical inbound communication.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-3">
      <Field label="Status" id="reply-status"><select id="reply-status" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value as RelationshipReplyStatus | '')}><option value="">Any status</option>{relationshipReplyStatuses.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></Field>
      <Field label="Owner profile ID" id="reply-owner"><Input id="reply-owner" value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Optional UUID" /></Field>
      <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={unownedOnly} onChange={(event) => setUnownedOnly(event.target.checked)} />Unowned only</label>
    </CardContent></Card>
    {available && replies.data && <Card><CardHeader><CardTitle>Replies</CardTitle><CardDescription>{replies.data.total} matching replies.</CardDescription></CardHeader><CardContent className="space-y-4">
      {replies.data.items.map((reply) => { const draft = edit(reply); return <div key={reply.id} className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{reply.senderEmail}</p><p className="text-sm text-muted-foreground">{reply.subject ?? 'No subject'} · {new Date(reply.receivedAt).toLocaleString()}</p></div><div className="flex gap-2"><Badge variant={reply.status === 'new' || reply.status === 'needs_action' ? 'destructive' : 'outline'}>{labels[reply.status]}</Badge><Badge variant="secondary">Version {reply.version}</Badge></div></div>
        <p className="whitespace-pre-wrap rounded bg-muted/40 p-3 text-sm">{reply.body || 'No plain-text body was supplied by the provider.'}</p>
        <div className="grid gap-3 md:grid-cols-3"><Field label="Workflow status" id={`status-${reply.id}`}><select id={`status-${reply.id}`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={draft.status} onChange={(event) => patch(reply, { status: event.target.value as RelationshipReplyStatus })}>{relationshipReplyStatuses.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></Field><Field label="Owner profile ID" id={`owner-${reply.id}`}><Input id={`owner-${reply.id}`} value={draft.ownerId} onChange={(event) => patch(reply, { ownerId: event.target.value })} /></Field><Field label="Follow-up due" id={`due-${reply.id}`}><Input id={`due-${reply.id}`} type="datetime-local" value={draft.followUpDueAt} onChange={(event) => patch(reply, { followUpDueAt: event.target.value })} /></Field></div>
        <div className="flex flex-wrap gap-3"><Input className="min-w-72 flex-1" value={draft.reason} onChange={(event) => patch(reply, { reason: event.target.value })} placeholder="Reason or handoff note" /><Button disabled={update.isPending} onClick={() => update.mutate({ reply, draft })}>{update.isPending ? 'Saving…' : 'Save workflow'}</Button></div>
      </div>; })}
      {replies.data.items.length === 0 && <p className="text-sm text-muted-foreground">No replies match the current filters.</p>}
      {update.isError && <p className="text-sm text-destructive">{message(update.error)}</p>}
    </CardContent></Card>}
    {replies.isError && <Card><CardHeader><CardTitle>Reply queue could not be loaded</CardTitle><CardDescription>{message(replies.error)}</CardDescription></CardHeader></Card>}
  </div>;
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) { return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>; }
function toLocalInput(value: string) { const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function message(error: unknown) { return error instanceof Error ? error.message : 'The reply workflow could not be completed.'; }
