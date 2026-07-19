import { DatabaseZap, LockKeyhole, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { CapabilityAvailability } from '@/domain/relationships/contracts';

type Props = {
  state?: CapabilityAvailability;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  children?: React.ReactNode;
};

function copyFor(state: CapabilityAvailability) {
  switch (state.status) {
    case 'permission_denied': return { title: 'Access required', detail: 'You do not have access to this relationship capability.', icon: LockKeyhole };
    case 'network_error': return { title: 'Connection unavailable', detail: 'The relationship service could not be reached. Try again when your connection is restored.', icon: WifiOff };
    case 'query_error': return { title: 'Service unavailable', detail: 'This relationship capability could not be loaded. Try again later.', icon: DatabaseZap };
    case 'invalid_response': return { title: 'Service response unavailable', detail: 'This relationship capability returned an invalid response. Try again later.', icon: DatabaseZap };
    case 'available': return { title: 'Database support available', detail: 'This capability is available for its implemented relationship workspace.', icon: DatabaseZap };
    default: return { title: 'Database support pending', detail: 'This relationship capability is awaiting the separate database implementation. No relationship data is read or written.', icon: DatabaseZap };
  }
}

/** Staff-safe state surface: diagnostics stay in the adapter and are never rendered. */
export function RelationshipCapabilityState({ state, isLoading, isError, onRetry, children }: Props) {
  if (isLoading) return <Card aria-label="Loading relationship capability"><CardHeader><Skeleton className="h-6 w-56" /><Skeleton className="h-4 w-full" /></CardHeader></Card>;
  if (isError || !state) {
    return <Card><CardHeader><CardTitle>Relationship service unavailable</CardTitle><CardDescription>Capability status could not be loaded. Try again later.</CardDescription></CardHeader><CardContent>{onRetry && <Button variant="outline" onClick={onRetry}>Try again</Button>}</CardContent></Card>;
  }
  const copy = copyFor(state);
  const Icon = copy.icon;
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5" />{copy.title}</CardTitle><CardDescription>{copy.detail}</CardDescription></CardHeader>{state.available && children && <CardContent>{children}</CardContent>}</Card>;
}
