import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';

type NewsletterUnsubscribeOutcome = 'unsubscribed' | 'already_unsubscribed' | 'invalid_token' | 'expired_token';

async function processNewsletterUnsubscribe(token: string): Promise<{ outcome: NewsletterUnsubscribeOutcome }> {
  const { data, error } = await supabase.rpc('crm_process_newsletter_unsubscribe', { p_token: token });
  if (error) throw new Error(error.message);
  const outcome = (data as { outcome?: string } | null)?.outcome;
  return { outcome: (outcome ?? 'invalid_token') as NewsletterUnsubscribeOutcome };
}

export default function NewsletterUnsubscribePage() {
  const [searchParams] = useSearchParams();
  const [token] = useState(() => searchParams.get('token')?.trim() ?? '');
  const mutation = useMutation({ mutationFn: () => processNewsletterUnsubscribe(token) });

  const outcome = mutation.data?.outcome;
  const successful = outcome === 'unsubscribed' || outcome === 'already_unsubscribed';

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-16">
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Newsletter preferences</CardTitle>
          <CardDescription>
            This page applies only to the ValorWell newsletter. It does not change healthcare, appointment, billing, or
            other service communications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token && <p className="text-sm text-destructive">This unsubscribe link is incomplete or invalid.</p>}
          {token && !mutation.data && (
            <>
              <p className="text-sm text-muted-foreground">
                Confirm that this email address should stop receiving the newsletter. Everyone who shares this mailbox is
                covered by this choice.
              </p>
              <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending ? 'Processing…' : 'Confirm unsubscribe'}
              </Button>
            </>
          )}
          {mutation.isError && (
            <p className="text-sm text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : 'The unsubscribe request could not be processed.'}
            </p>
          )}
          {successful && (
            <div className="space-y-2">
              <p className="font-medium">You are unsubscribed from the newsletter.</p>
              <p className="text-sm text-muted-foreground">
                Service and care-related email is unaffected. Following this link again will not create duplicate records.
              </p>
            </div>
          )}
          {outcome === 'invalid_token' && <p className="text-sm text-destructive">This unsubscribe link is invalid.</p>}
          {outcome === 'expired_token' && <p className="text-sm text-destructive">This unsubscribe link has expired.</p>}
        </CardContent>
      </Card>
    </main>
  );
}
