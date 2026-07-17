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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { XCircle, Info } from 'lucide-react';
import { useClientMutations, clientKeys } from '@/hooks/canonical/useCanonicalClients';
import { CLOSURE_REASONS, type ClosureReason } from '@/domain/canonical';
import { allowedLifecycleTransitionsKey } from '@/hooks/crm/useAllowedLifecycleTransitions';

interface CloseClientDialogProps {
  clientId: string;
  disabled?: boolean;
}

/**
 * Dedicated Close Client dialog (Phase 11).
 * - Disposition uses the exact contract vocabulary (CLOSURE_REASONS).
 * - Reason required (min 3 chars); optional notes appended.
 * - Repo layer fetches a real concurrency_token, mints a fresh idempotency
 *   key, and passes the contract version — no "auto" tokens permitted.
 * - Lifecycle dropdown no longer offers "Closed" (handled in LifecycleControl).
 */
export function CloseClientDialog({ clientId, disabled }: CloseClientDialogProps) {
  const qc = useQueryClient();
  const { close } = useClientMutations(clientId);
  const [open, setOpen] = useState(false);
  const [disposition, setDisposition] = useState<ClosureReason | ''>('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  function reset() {
    setDisposition('');
    setReason('');
    setNotes('');
  }

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: clientKeys.one(clientId) });
    qc.invalidateQueries({ queryKey: ['canonical-clients'] });
    qc.invalidateQueries({ queryKey: allowedLifecycleTransitionsKey(clientId) });
    qc.invalidateQueries({ queryKey: ['crm-activity', clientId] });
  }

  const canSubmit = !!disposition && reason.trim().length >= 3 && !close.isPending;

  function submit() {
    if (!canSubmit || !disposition) return;
    const trimmedReason = reason.trim();
    const trimmedNotes = notes.trim();
    close.mutate(
      {
        closureReason: disposition,
        notes: trimmedNotes ? `${trimmedReason} — ${trimmedNotes}` : trimmedReason,
      },
      {
        onSuccess: () => {
          toast.success('Client closed');
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
            toast.error(`Close refused: ${msg}`);
          }
        },
      },
    );
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
          <XCircle className="h-3.5 w-3.5" />
          Close Client
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Close Client</DialogTitle>
          <DialogDescription>
            Move this client to <span className="font-medium">Closed</span>. All fields below are
            recorded on the audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="disposition">Disposition</Label>
            <Select value={disposition} onValueChange={(v) => setDisposition(v as ClosureReason)}>
              <SelectTrigger id="disposition">
                <SelectValue placeholder="Select a disposition…" />
              </SelectTrigger>
              <SelectContent>
                {CLOSURE_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason (required)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Short reason recorded on the audit trail (min 3 chars)"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Additional notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context that should live on the audit entry"
              rows={3}
            />
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>What closing does</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 text-sm space-y-1">
                <li>Sets lifecycle to <b>Closed</b> with the disposition above.</li>
                <li>Cancels any active campaign enrollment for this client.</li>
                <li>Suppresses further outbound automations until reopened.</li>
                <li>Preserves history — a Reopen action remains available.</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={close.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={!canSubmit}>
            {close.isPending ? 'Closing…' : 'Close Client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
