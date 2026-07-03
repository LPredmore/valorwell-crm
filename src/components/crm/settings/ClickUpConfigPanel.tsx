import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const REQUIRED_FIELDS = [
  'Supabase Client ID',
  'Email',
  'Phone',
  'Client Status - EHR',
  'State',
  'Assigned Therapist',
  'Campaigns',
  'Last Campaign At',
  'Last Synced At',
  'Sync Source',
];

export function ClickUpConfigPanel() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const runBackfill = async () => {
    setRunning(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('clickup-sync', {
        body: { action: 'backfill' },
      });
      if (error) throw error;
      setLastResult(JSON.stringify(data, null, 2));
      toast({ title: 'ClickUp sync complete', description: `Synced ${data?.total ?? 0} clients` });
    } catch (e) {
      toast({
        title: 'Sync failed',
        description: (e as Error).message,
        variant: 'destructive',
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ClickUp Sync</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm space-y-1">
          <p className="text-muted-foreground">
            Clients are automatically pushed to ClickUp List{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">901327741230</code> whenever
            core fields or campaign enrollments change. This is one-way; ClickUp edits are
            overwritten on the next sync.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium mb-1">Required custom fields on the ClickUp List</p>
          <ul className="text-xs text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-0.5">
            {REQUIRED_FIELDS.map((f) => (
              <li key={f}>• {f}</li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={runBackfill} disabled={running} size="sm">
            {running ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Syncing…</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" /> Sync all clients now</>
            )}
          </Button>
        </div>

        {lastResult && (
          <pre className="text-xs bg-muted p-2 rounded max-h-48 overflow-auto">{lastResult}</pre>
        )}
      </CardContent>
    </Card>
  );
}
