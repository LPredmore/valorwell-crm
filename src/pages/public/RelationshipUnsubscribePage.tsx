import { useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { planRelationshipUnsubscribe } from '@/services/relationships/unsubscribe';

/** Public, non-authenticated relationship unsubscribe surface. The token is never rendered. */
export default function RelationshipUnsubscribePage() {
  const { token } = useParams();
  const { capability, isLoading, isError } = useRelationshipCapability('unsubscribe');
  const plan = planRelationshipUnsubscribe({ token, capability });
  const title = isLoading ? 'Checking unsubscribe link' : isError ? 'Unsubscribe service unavailable' : plan.outcome === 'unsubscribed' ? 'Unsubscribe ready' : plan.outcome === 'already_unsubscribed' ? 'Already unsubscribed' : plan.outcome === 'invalid_token' ? 'Invalid unsubscribe link' : 'Unsubscribe processing pending';
  const message = isError ? 'The relationship unsubscribe service could not be checked. No preferences were changed.' : plan.message;

  return <main className="mx-auto flex min-h-screen max-w-xl items-center p-6"><Card className="w-full"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>ValorWell relationship outreach only</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">{message}</p></CardContent></Card></main>;
}
