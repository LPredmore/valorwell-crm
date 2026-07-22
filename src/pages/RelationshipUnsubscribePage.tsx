import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { dataProvider } from '@/services/dataProvider';

export default function RelationshipUnsubscribePage() {
  const [searchParams] = useSearchParams();
  const [confirmedToken] = useState(() => searchParams.get('token')?.trim() ?? '');
  const mutation = useMutation({
    mutationFn: () => dataProvider.relationships.processUnsubscribe({ token: confirmedToken }),
  });

  const outcome = mutation.data?.outcome;
  const successful = outcome === 'unsubscribed' || outcome === 'already_unsubscribed';

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-16">
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Relationship outreach preferences</CardTitle>
          <CardDescription>This page applies only to non-clinical ValorWell relationship and partnership outreach. It does not change healthcare, appointment, billing, or client communications.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!confirmedToken && <p className="text-sm text-destructive">This unsubscribe link is incomplete or invalid.</p>}
          {confirmedToken && !mutation.data && (
            <>
              <p className="text-sm text-muted-foreground">Confirm that this email address should stop receiving future relationship-outreach messages.</p>
              <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Processing…' : 'Confirm unsubscribe'}</Button>
            </>
          )}
          {mutation.isError && <p className="text-sm text-destructive">{mutation.error instanceof Error ? mutation.error.message : 'The unsubscribe request could not be processed.'}</p>}
          {mutation.data && successful && <div className="space-y-2"><p className="font-medium">You are unsubscribed.</p><p className="text-sm text-muted-foreground">Future relationship outreach to {mutation.data.email ?? 'this address'} is blocked. Replaying this link will not create duplicate records.</p></div>}
          {mutation.data?.outcome === 'invalid_token' && <p className="text-sm text-destructive">This unsubscribe link is invalid or expired.</p>}
        </CardContent>
      </Card>
    </main>
  );
}
