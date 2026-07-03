import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCrmAuth } from '@/contexts/CrmAuthContext';

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

interface SyncRun {
  id: string;
  tenant_id: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  created_count: number;
  updated_count: number;
  recreated_count: number;
  skipped_count: number;
  failed_count: number;
  last_error: string | null;
  started_at: string;
  finished_at: string | null;
}

export function ClickUpConfigPanel() {
  const { toast } = useToast();
  const { tenantId } = useCrmAuth();
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState<SyncRun | null>(null);
  const [onlyUnsynced, setOnlyUnsynced] = useState(true);

  const isActive = run?.status === 'queued' || run?.status === 'running';

  // Load the most recent run for this tenant on mount so refreshing the tab
  // re-attaches to an in-flight backfill.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('crm_clickup_sync_runs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && data) setRun(data as SyncRun);
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  // Realtime subscription to the active run's row.
  useEffect(() => {
    if (!run?.id) return;
    const channel = supabase
      .channel(`clickup-sync-run-${run.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'crm_clickup_sync_runs', filter: `id=eq.${run.id}` },
        (payload) => setRun(payload.new as SyncRun),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [run?.id]);

  // Poll fallback every 5s while active in case realtime is lagging.
  useEffect(() => {
    if (!isActive || !run?.id) return;
    const t = setInterval(async () => {
      const { data } = await supabase
        .from('crm_clickup_sync_runs')
        .select('*')
        .eq('id', run.id)
        .maybeSingle();
      if (data) setRun(data as SyncRun);
    }, 5000);
    return () => clearInterval(t);
  }, [isActive, run?.id]);

  const startBackfill = useCallback(async () => {
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke('clickup-sync', {
        body: { action: 'backfill', tenant_id: tenantId || undefined, only_unsynced: onlyUnsynced },
      });
      if (error) throw error;
      if (!data?.run_id) throw new Error('No run id returned');
      // Fetch the fresh row (insert may not have hit realtime yet).
      const { data: row } = await supabase
        .from('crm_clickup_sync_runs')
        .select('*')
        .eq('id', data.run_id)
        .maybeSingle();
      if (row) setRun(row as SyncRun);
      toast({ title: 'Sync started', description: `Processing ${data.total} clients in the background` });
    } catch (e) {
      toast({ title: 'Sync failed to start', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setStarting(false);
    }
  }, [tenantId, onlyUnsynced, toast]);

  const cancel = useCallback(async () => {
    if (!run?.id) return;
    try {
      await supabase.functions.invoke('clickup-sync', {
        body: { action: 'cancel_backfill', run_id: run.id },
      });
      toast({ title: 'Cancellation requested' });
    } catch (e) {
      toast({ title: 'Cancel failed', description: (e as Error).message, variant: 'destructive' });
    }
  }, [run?.id, toast]);

  const pct = run && run.total > 0 ? Math.round((run.processed / run.total) * 100) : 0;
  const etaMin = run && isActive && run.total > run.processed
    ? Math.ceil(((run.total - run.processed) * 6) / 60)
    : null;

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

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyUnsynced}
            onChange={(e) => setOnlyUnsynced(e.target.checked)}
            disabled={isActive}
          />
          Only sync clients that don't yet have a ClickUp task
        </label>

        <div className="flex items-center gap-2">
          <Button onClick={startBackfill} disabled={starting || isActive} size="sm">
            {starting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting…</>
            ) : isActive ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Syncing…</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" /> Sync all clients now</>
            )}
          </Button>
          {isActive && (
            <Button onClick={cancel} variant="outline" size="sm">
              <X className="h-4 w-4 mr-2" /> Cancel
            </Button>
          )}
        </div>

        {run && (
          <div className="space-y-2 rounded border p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium capitalize">{run.status}</span>
              <span className="text-muted-foreground">
                {run.processed} / {run.total} ({pct}%)
                {etaMin != null && ` · ~${etaMin} min left`}
              </span>
            </div>
            <Progress value={pct} />
            <div className="text-xs text-muted-foreground">
              created {run.created_count} · updated {run.updated_count} · recreated {run.recreated_count} · skipped {run.skipped_count} · failed {run.failed_count}
            </div>
            {run.last_error && (
              <div className="text-xs text-destructive truncate" title={run.last_error}>
                Last error: {run.last_error}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground">
              Started {new Date(run.started_at).toLocaleString()}
              {run.finished_at && ` · Finished ${new Date(run.finished_at).toLocaleString()}`}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
