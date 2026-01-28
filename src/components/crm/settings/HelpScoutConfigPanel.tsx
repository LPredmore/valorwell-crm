import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useHelpScoutSettings } from '@/hooks/crm/useHelpScoutSettings';
import { Loader2, CheckCircle, XCircle, RefreshCw, Mail } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function HelpScoutConfigPanel() {
  const { settings, isLoading, testConnection, updateSettings, isConnected } = useHelpScoutSettings();
  const { toast } = useToast();
  const [fromName, setFromName] = useState(settings?.from_name || '');
  const [fromEmail, setFromEmail] = useState(settings?.from_email || '');

  const handleTestConnection = async () => {
    try {
      await testConnection.mutateAsync();
      toast({
        title: 'Connection successful',
        description: 'HelpScout is connected and ready to use.',
      });
    } catch (error) {
      toast({
        title: 'Connection failed',
        description: error instanceof Error ? error.message : 'Failed to connect to HelpScout',
        variant: 'destructive',
      });
    }
  };

  const handleSaveSettings = async () => {
    try {
      await updateSettings.mutateAsync({
        from_name: fromName || null,
        from_email: fromEmail || null,
      });
      toast({
        title: 'Settings saved',
        description: 'Your HelpScout settings have been updated.',
      });
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save settings',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              HelpScout Connection
            </CardTitle>
            <CardDescription>
              Connect to HelpScout for email integration.
            </CardDescription>
          </div>
          <ConnectionStatusBadge status={settings?.connection_status || 'disconnected'} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Connection Status */}
        <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
          <div className="space-y-1">
            <p className="text-sm font-medium">Connection Status</p>
            <p className="text-xs text-muted-foreground">
              {settings?.last_sync_at 
                ? `Last synced: ${new Date(settings.last_sync_at).toLocaleString()}`
                : 'Never synced'}
            </p>
          </div>
          <Button
            onClick={handleTestConnection}
            disabled={testConnection.isPending}
            variant={isConnected ? 'outline' : 'default'}
          >
            {testConnection.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {isConnected ? 'Re-test Connection' : 'Test Connection'}
          </Button>
        </div>

        {/* From Identity Settings */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="from-name">From Name (Display)</Label>
            <Input
              id="from-name"
              placeholder="ValorWell Support"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Name that appears as the sender for outgoing emails.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="from-email">From Email</Label>
            <Input
              id="from-email"
              type="email"
              placeholder="support@valorwell.org"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Email address for replies (must be verified in HelpScout).
            </p>
          </div>

          <Button
            onClick={handleSaveSettings}
            disabled={updateSettings.isPending}
          >
            {updateSettings.isPending && (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            )}
            Save Settings
          </Button>
        </div>

        {/* Info about secrets */}
        <div className="text-xs text-muted-foreground border-t pt-4">
          <p>
            <strong>Note:</strong> HelpScout API credentials (App ID, App Secret, Mailbox ID) 
            are configured as secure environment variables and cannot be changed here.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'connected':
      return (
        <Badge variant="default">
          <CheckCircle className="h-3 w-3 mr-1" />
          Connected
        </Badge>
      );
    case 'error':
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Error
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          Disconnected
        </Badge>
      );
  }
}
