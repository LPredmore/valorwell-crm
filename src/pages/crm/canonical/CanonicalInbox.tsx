import { useState } from 'react';
import { useMessageThreads } from '@/hooks/canonical/useCrmData';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function CanonicalInbox() {
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const { data, isLoading } = useMessageThreads(channel);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Communications</h1>
          <p className="text-sm text-muted-foreground">SMS and Email threads</p>
        </div>
        <div className="flex rounded-md border">
          <Button variant={channel === 'sms' ? 'secondary' : 'ghost'} size="sm" onClick={() => setChannel('sms')}>SMS</Button>
          <Button variant={channel === 'email' ? 'secondary' : 'ghost'} size="sm" onClick={() => setChannel('email')}>Email</Button>
        </div>
      </div>

      <Card className="divide-y">
        {isLoading && <div className="p-8 text-center text-muted-foreground">Loading…</div>}
        {data?.length === 0 && <div className="p-8 text-center text-muted-foreground">No messages.</div>}
        {data?.map(m => (
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
    </div>
  );
}
