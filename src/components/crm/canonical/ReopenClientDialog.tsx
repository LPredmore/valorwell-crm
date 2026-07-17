import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RotateCcw, Info } from 'lucide-react';
import { useClientMutations, clientKeys } from '@/hooks/canonical/useCanonicalClients';
import { allowedLifecycleTransitionsKey } from '@/hooks/crm/useAllowedLifecycleTransitions';

interface ReopenClientDialogProps {
  clientId: string;
  disabled?: boolean;
}

/**
 * Phase 12 — Reopen Client dialog.
 * - Visible only when the client is currently Closed (parent guards visibility).
 * - Reason required (min 3 chars); recorded on the audit trail.
 * - Delegates to `dataProvider.clients.reopen` -> `crm_reopen_client` RPC.
 * - Preserves the historical closure event; does NOT auto-restart cancelled
 *   campaigns.
 */
export function ReopenClientDialog({ clientId, disabled }: ReopenClientDialogProps) {
  const qc = useQueryClient();
  const { reopen } = useClientMutations(clientId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  function reset() {
    setReason('');
  }

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: clientKeys.one(clientId) });
    qc.invalidateQueries({ queryKey: ['canonical-clients'] });
    qc.invalidateQueries({ queryKey: allowedLifecycleTransitionsKey(clientId) });
    qc.invalidateQueries({ queryKey: ['crm-activity', clientId] });
  }

  const canSubmit = reason.trim().length >= 3 && !reopen.isPending;

  function submit() {
    if (!canSubmit) return;
    reopen.mutate(reason.trim(), {
      onSuccess: () => {
        toast.success('Client reopened');
        invalidateAll();
        reset();
        setOpen(false);
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('concurrency_conflict')) {
          toast.error('Client was updated by someone else. Refreshing…');
          invalidateAll();
        } else {
          toast.error(`Reopen refused: ${msg}`);
        }
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Reopen Client
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reopen Client</DialogTitle>
          <DialogDescription>
            Move this client out of <span className="font-medium">Closed</span>. The reason below is
            recorded on the audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reopen-reason">Reason (required)</Label>
            <Textarea
              id="reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this client being reopened? (min 3 chars)"
              rows={3}
            />
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>What reopening does</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 text-sm space-y-1">
                <li>Returns lifecycle to an active stage via <b>crm_reopen_client</b>.</li>
                <li>Preserves the prior closure event on the audit trail.</li>
                <li>Does <b>not</b> auto-restart cancelled campaigns — re-enroll manually if needed.</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={reopen.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {reopen.isPending ? 'Reopening…' : 'Reopen Client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
