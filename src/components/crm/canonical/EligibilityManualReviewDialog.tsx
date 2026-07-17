import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useClientMutations } from '@/hooks/canonical/useCanonicalClients';
import { toast } from 'sonner';
import { ClipboardList } from 'lucide-react';

export interface ManualReviewInput {
  owner: string;
  next_action: string;
  review_due_at: string;
}

export function EligibilityManualReviewDialog({
  clientId,
  triggerLabel = 'Set Manual Review',
  variant = 'outline',
}: {
  clientId: string;
  triggerLabel?: string;
  variant?: 'outline' | 'default' | 'secondary';
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [owner, setOwner] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [reviewDueAt, setReviewDueAt] = useState('');
  const { updateEligibility } = useClientMutations(clientId);

  const canSubmit =
    reason.trim().length >= 3 &&
    owner.trim().length > 0 &&
    nextAction.trim().length > 0 &&
    reviewDueAt.length > 0;

  const reset = () => {
    setReason(''); setOwner(''); setNextAction(''); setReviewDueAt('');
  };

  const submit = () => {
    if (!canSubmit) {
      toast.error('Reason, owner, next action, and review due date are all required.');
      return;
    }
    updateEligibility.mutate(
      {
        next: 'Manual Review',
        note: reason.trim(),
        manualReview: {
          owner: owner.trim(),
          next_action: nextAction.trim(),
          review_due_at: new Date(reviewDueAt).toISOString(),
        },
      },
      {
        onSuccess: () => {
          toast.success('Eligibility set to Manual Review');
          setOpen(false);
          reset();
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : 'Failed to set Manual Review';
          toast.error(msg);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant}>
          <ClipboardList className="mr-1.5 h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set eligibility to Manual Review</DialogTitle>
          <DialogDescription>
            Manual Review requires an owner and a next action so nothing stalls in the queue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="mr-reason">Reason</Label>
            <Textarea id="mr-reason" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Why does this need manual review?" rows={2} />
            <p className="mt-1 text-xs text-muted-foreground">Minimum 3 characters — recorded in the audit trail.</p>
          </div>
          <div>
            <Label htmlFor="mr-owner">Owner</Label>
            <Input id="mr-owner" value={owner} onChange={(e) => setOwner(e.target.value)}
              placeholder="Person or team responsible" />
          </div>
          <div>
            <Label htmlFor="mr-next">Next action</Label>
            <Input id="mr-next" value={nextAction} onChange={(e) => setNextAction(e.target.value)}
              placeholder="e.g. Call payer to verify coverage" />
          </div>
          <div>
            <Label htmlFor="mr-due">Review due</Label>
            <Input id="mr-due" type="date" value={reviewDueAt} onChange={(e) => setReviewDueAt(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || updateEligibility.isPending}>
            {updateEligibility.isPending ? 'Saving…' : 'Set Manual Review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
