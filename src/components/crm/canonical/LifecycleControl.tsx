import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAllowedLifecycleTransitions, allowedLifecycleTransitionsKey } from '@/hooks/crm/useAllowedLifecycleTransitions';
import { useClientMutations } from '@/hooks/canonical/useCanonicalClients';
import type { LifecycleStage } from '@/domain/canonical';
import { clientKeys } from '@/hooks/canonical/useCanonicalClients';

interface LifecycleControlProps {
  clientId: string;
  currentStage: string;
}

const REASON_CODE_COPY: Record<string, string> = {
  current_stage: 'Already in this stage',
  use_close_client: 'Use the Close Client action',
  not_permitted_from_current: 'Not permitted from current stage',
};

export function LifecycleControl({ clientId, currentStage }: LifecycleControlProps) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useAllowedLifecycleTransitions(clientId);
  const { updateLifecycle } = useClientMutations(clientId);
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: allowedLifecycleTransitionsKey(clientId) });
    qc.invalidateQueries({ queryKey: clientKeys.one(clientId) });
    qc.invalidateQueries({ queryKey: ['canonical-clients'] });
  }

  function submit() {
    if (!pendingStage || reason.trim().length < 3) return;
    updateLifecycle.mutate(
      { next: pendingStage as LifecycleStage, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(`Lifecycle transitioned to ${pendingStage}`);
          setPendingStage(null);
          setReason('');
          invalidateAll();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('concurrency_conflict')) {
            toast.error('Client was updated by someone else. Refreshing…');
            invalidateAll();
            void refetch();
          } else {
            toast.error(`Transition refused: ${msg}`);
          }
        },
      },
    );
  }

  const options = data?.transitions ?? [];

  return (
    <>
      <Select
        value={currentStage}
        onValueChange={(v) => {
          const opt = options.find((o) => o.stage === v);
          if (!opt || !opt.allowed) return;
          setPendingStage(v);
          setReason('');
        }}
        disabled={isLoading || isError}
      >
        <SelectTrigger className="h-8 flex-1">
          <SelectValue placeholder={isError ? 'Unavailable' : currentStage} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem
              key={opt.stage}
              value={opt.stage}
              disabled={!opt.allowed}
              className={!opt.allowed ? 'opacity-50' : ''}
            >
              <div className="flex flex-col">
                <span>{opt.stage}</span>
                {!opt.allowed && opt.reason_code && (
                  <span className="text-xs text-muted-foreground">
                    {REASON_CODE_COPY[opt.reason_code] ?? opt.message ?? opt.reason_code}
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={!!pendingStage} onOpenChange={(open) => { if (!open) { setPendingStage(null); setReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transition lifecycle → {pendingStage}</DialogTitle>
            <DialogDescription>
              Provide a reason. This is recorded in the client audit trail.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required, min 3 chars)"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPendingStage(null); setReason(''); }}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={reason.trim().length < 3 || updateLifecycle.isPending}
            >
              {updateLifecycle.isPending ? 'Applying…' : 'Confirm transition'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
