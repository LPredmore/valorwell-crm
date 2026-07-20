import type { RelationshipReply } from '@/domain/relationships/contracts';

export function RelationshipReplyInbox({ replies }: { replies: RelationshipReply[] }) {
  if (!replies.length) return <p className="text-sm text-muted-foreground">No relationship replies match the current inbox view.</p>;
  return <div className="divide-y rounded border">
    {replies.map((reply) => <article className="space-y-1 p-3" key={reply.id}>
      <div className="flex justify-between gap-3"><p className="font-medium">{reply.status.replace('_', ' ')}</p><time className="text-sm text-muted-foreground">{reply.receivedAt}</time></div>
      <p className="text-sm text-muted-foreground">{reply.body}</p>
      <p className="text-xs text-muted-foreground">Owner: {reply.ownerId ?? 'Unassigned'} · Next action: {reply.followUpDueAt ?? 'Not scheduled'}</p>
    </article>)}
  </div>;
}
