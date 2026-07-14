import { useState } from 'react';
import { useMessageThreads } from '@/hooks/canonical/useCrmData';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { PolicyAwareComposer } from '@/components/crm/canonical/PolicyAwareComposer';
import { CrmMutationGate } from '@/components/crm/auth/CrmMutationGate';

export default function CanonicalInbox() {
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [composerOpen, setComposerOpen] = useState(false);
  const { data, isLoading } = useMessageThreads(channel);

  const firstClientId = data?.find((m) => m.clientId)?.clientId ?? '';

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Communications</h1>
          <p className="text-sm text-muted-foreground">SMS and Email threads</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border">
            <Button variant={channel === 'sms' ? 'secondary' : 'ghost'} size="sm" onClick={() => setChannel('sms')}>SMS</Button>
            <Button variant={channel === 'email' ? 'secondary' : 'ghost'} size="sm" onClick={() => setChannel('email')}>Email</Button>
          </div>
          <CrmMutationGate>
            <Button size="sm" className="gap-2" onClick={() => setComposerOpen(true)} disabled={!firstClientId}>
              <Plus className="h-4 w-4" /> Compose
            </Button>
          </CrmMutationGate>
        </div>
      </div>

      <Card className="divide-y">
        {isLoading && <div className="p-8 text-center text-muted-foreground">Loading…</div>}
        {data?.length === 0 && <div className="p-8 text-center text-muted-foreground">No messages.</div>}
        {data?.map((m) => (
          <div key={m.id} className="p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{m.direction === 'inbound' ? m.from : m.to}</span>
              <span className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</span>
            </div>
            {m.subject && <div className="mt-1 font-medium">{m.subject}</div>}
            <div className="mt-1 line-clamp-2 text-muted-foreground">{m.body}</div>
          </div>
        ))}
      </Card>

      {firstClientId && (
        <PolicyAwareComposer
          open={composerOpen}
          onOpenChange={setComposerOpen}
          clientId={firstClientId}
          defaultChannel={channel}
        />
      )}
    </div>
  );
}
