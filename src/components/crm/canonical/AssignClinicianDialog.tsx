import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useClientMutations } from '@/hooks/canonical/useCanonicalClients';
import { useStaffList } from '@/hooks/canonical/useCrmData';
import { toast } from 'sonner';
import { UserCog } from 'lucide-react';
import type { CanonicalClient } from '@/domain/canonical';

export function AssignClinicianDialog({
  client,
  triggerLabel,
  variant = 'outline',
}: {
  client: CanonicalClient;
  triggerLabel?: string;
  variant?: 'outline' | 'default' | 'secondary';
}) {
  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const { assignClinician } = useClientMutations(client.id);
  const { data: staff = [], isLoading: staffLoading } = useStaffList();

  const label = triggerLabel ?? (client.assignedClinicianId ? 'Reassign Clinician' : 'Assign Clinician');

  // Server-authoritative filter until eligibility view ships:
  // tenant match, clinician/staff role, active, accepting new clients (unless already assigned).
  const eligible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff
      .filter((s) => s.tenantId === client.tenantId)
      .filter((s) => s.status === 'Active')
      .filter((s) => s.role === 'clinician' || s.role === 'staff')
      .filter((s) => s.availability !== 'Unavailable')
      .filter((s) => (q ? s.displayName.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) : true))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [staff, client.tenantId, search]);

  const canSubmit = staffId.length > 0 && reason.trim().length >= 3 && staffId !== client.assignedClinicianId;

  const reset = () => { setStaffId(''); setReason(''); setSearch(''); };

  const submit = () => {
    if (!canSubmit) return;
    assignClinician.mutate(
      { staffId, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success('Clinician assigned');
          setOpen(false);
          reset();
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : 'Failed to assign clinician';
          if (msg.toLowerCase().includes('concurrency')) {
            toast.error('State changed since you loaded this page — please retry.');
          } else {
            toast.error(msg);
          }
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant}>
          <UserCog className="mr-1.5 h-3.5 w-3.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{client.assignedClinicianId ? 'Reassign clinician' : 'Assign clinician'}</DialogTitle>
          <DialogDescription>
            Choose an active clinician in this tenant. The canonical RPC records the change and updates the client's audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="ac-search">Search</Label>
            <Input
              id="ac-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email"
            />
          </div>
          <div>
            <Label htmlFor="ac-staff">Clinician</Label>
            <Select value={staffId} onValueChange={setStaffId} disabled={staffLoading}>
              <SelectTrigger id="ac-staff">
                <SelectValue placeholder={staffLoading ? 'Loading…' : 'Select clinician'} />
              </SelectTrigger>
              <SelectContent>
                {eligible.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No eligible clinicians.</div>
                )}
                {eligible.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.displayName}
                    {s.availability === 'Full' ? ' · at capacity' : ''}
                    {s.states.length ? ` · ${s.states.join(', ')}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {client.assignedClinicianId && (
              <p className="mt-1 text-xs text-muted-foreground">
                Current: {staff.find((s) => s.id === client.assignedClinicianId)?.displayName ?? client.assignedClinicianId}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="ac-reason">Reason</Label>
            <Textarea
              id="ac-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this clinician being assigned?"
              rows={2}
            />
            <p className="mt-1 text-xs text-muted-foreground">Minimum 3 characters — recorded in the audit trail.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || assignClinician.isPending}>
            {assignClinician.isPending ? 'Saving…' : (client.assignedClinicianId ? 'Reassign' : 'Assign')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
