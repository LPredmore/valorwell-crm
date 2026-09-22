import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { CrmMutationGate } from '@/components/crm/auth/CrmMutationGate';
import { verifyYouTubeConnection, type YouTubeConnectionStatus as ConnectionState } from '@/lib/crm/social-media';

const STATE_VARIANT: Record<ConnectionState['state'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  connected: 'default',
  configured: 'secondary',
  needs_reauth: 'destructive',
  error: 'destructive',
  disabled: 'outline',
};

export function YouTubeConnectionStatus({ status }: { status: ConnectionState | undefined }) {
  const queryClient = useQueryClient();
  const verifyMutation = useMutation({
    mutationFn: verifyYouTubeConnection,
    onSuccess: (result) => {
      queryClient.setQueryData(['social-media', 'youtube-connection'], result);
      toast({ title: `Connection state: ${result.state}` });
    },
    onError: (error: Error) => toast({ title: 'Verification failed', description: error.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-2 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">YouTube connection</h3>
        {status && <Badge variant={STATE_VARIANT[status.state]}>{status.state}</Badge>}
      </div>
      {status?.channelTitle && <p className="text-sm text-muted-foreground">Channel: {status.channelTitle} ({status.channelId})</p>}
      {status?.reason && <p className="text-sm text-destructive">{status.reason}</p>}
      {status?.missingScopes && status.missingScopes.length > 0 && (
        <p className="text-xs text-muted-foreground">Missing scopes: {status.missingScopes.join(', ')}</p>
      )}
      <CrmMutationGate>
        <Button size="sm" variant="outline" onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending}>
          Verify Connection
        </Button>
      </CrmMutationGate>
    </div>
  );
}
