import { useEffect, useState } from 'react';
import { CheckCircle, Loader2, Mail, RefreshCw, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useResendSettings } from '@/hooks/crm/useResendSettings';
import { useToast } from '@/hooks/use-toast';

export function ResendConfigPanel() {
  const { settings, isPending, testConnection, updateSettings, isConnected } = useResendSettings();
  const { toast } = useToast();
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [replyToEmail, setReplyToEmail] = useState('');
  const [inboundEmail, setInboundEmail] = useState('');

  useEffect(() => {
    setFromName(settings?.from_name ?? '');
    setFromEmail(settings?.from_email ?? '');
    setReplyToEmail(settings?.reply_to_email ?? '');
    setInboundEmail(settings?.inbound_email ?? '');
  }, [settings]);

  const handleTestConnection = async () => {
    try {
      const result = await testConnection.mutateAsync();
      toast({
        title: 'Resend connection verified',
        description: `${result.fromEmail} is ready. Verified domains: ${result.domains.join(', ')}.`,
      });
    } catch (error) {
      toast({
        title: 'Connection failed',
        description: error instanceof Error ? error.message : 'Failed to verify Resend',
        variant: 'destructive',
      });
    }
  };

  const handleSaveSettings = async () => {
    try {
      await updateSettings.mutateAsync({
        from_name: fromName.trim() || null,
        from_email: fromEmail.trim().toLowerCase() || null,
        reply_to_email: replyToEmail.trim().toLowerCase() || null,
        inbound_email: inboundEmail.trim().toLowerCase() || null,
      });
      toast({
        title: 'Settings saved',
        description: 'Resend sender and reply routing settings were updated. Re-test before sending.',
      });
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save Resend settings',
        variant: 'destructive',
      });
    }
  };

  if (isPending) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Resend Email
            </CardTitle>
            <CardDescription>Resend is the only email provider used by the CRM.</CardDescription>
          </div>
          <ConnectionStatusBadge status={settings?.connection_status ?? 'disconnected'} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/50 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Provider verification</p>
            <p className="text-xs text-muted-foreground">
              {settings?.last_verified_at
                ? `Last verified: ${new Date(settings.last_verified_at).toLocaleString()}`
                : 'Not yet verified'}
            </p>
          </div>
          <Button
            onClick={handleTestConnection}
            disabled={testConnection.isPending || !fromEmail.trim() || !inboundEmail.trim()}
            variant={isConnected ? 'outline' : 'default'}
          >
            {testConnection.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {isConnected ? 'Re-test' : 'Test connection'}
          </Button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="resend-from-name">From name</Label>
            <Input
              id="resend-from-name"
              placeholder="ValorWell Support"
              value={fromName}
              onChange={(event) => setFromName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resend-from-email">From email</Label>
            <Input
              id="resend-from-email"
              type="email"
              placeholder="support@valorwell.org"
              value={fromEmail}
              onChange={(event) => setFromEmail(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">The domain must be verified in Resend.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="resend-reply-to">Reply-to email</Label>
            <Input
              id="resend-reply-to"
              type="email"
              placeholder="support@reply.valorwell.org"
              value={replyToEmail}
              onChange={(event) => setReplyToEmail(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resend-inbound-email">Inbound receiving address</Label>
            <Input
              id="resend-inbound-email"
              type="email"
              placeholder="support@reply.valorwell.org"
              value={inboundEmail}
              onChange={(event) => setInboundEmail(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Resend Receiving and the CRM webhook must route this address into the CRM inbox.
            </p>
          </div>

          <Button onClick={handleSaveSettings} disabled={updateSettings.isPending}>
            {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save settings
          </Button>
        </div>

        <div className="border-t pt-4 text-xs text-muted-foreground">
          The Resend API key and webhook signing secret remain in Supabase secrets and are never exposed here.
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionStatusBadge({ status }: { status: string }) {
  if (status === 'connected') {
    return (
      <Badge variant="default">
        <CheckCircle className="mr-1 h-3 w-3" />
        Connected
      </Badge>
    );
  }
  if (status === 'error') {
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 h-3 w-3" />
        Error
      </Badge>
    );
  }
  return <Badge variant="secondary">Disconnected</Badge>;
}
