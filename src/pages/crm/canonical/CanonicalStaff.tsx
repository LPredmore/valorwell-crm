import { useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StaffBroadcastDialog } from '@/components/crm/canonical/StaffBroadcastDialog';
import type { StaffMember } from '@/domain/operations';
import { useStaffList } from '@/hooks/canonical/useCrmData';
import { useCanMutate } from '@/hooks/crm/useCanMutate';

export default function CanonicalStaff() {
  const { data, isLoading } = useStaffList();
  const canCommunicate = useCanMutate([], 'communicate');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  const eligible = useMemo(() => (data ?? []).filter(isBroadcastEligible), [data]);
  const selectedStaff = useMemo(
    () => (data ?? []).filter((staff) => selectedIds.has(staff.id) && isBroadcastEligible(staff)),
    [data, selectedIds],
  );
  const allEligibleSelected = eligible.length > 0 && eligible.every((staff) => selectedIds.has(staff.id));

  const toggleSelected = (staffId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      return next;
    });
  };

  const toggleAllEligible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allEligibleSelected) eligible.forEach((staff) => next.delete(staff.id));
      else eligible.forEach((staff) => next.add(staff.id));
      return next;
    });
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
          <p className="text-sm text-muted-foreground">Clinicians, operations, admins</p>
        </div>
        {canCommunicate ? (
          <Button onClick={() => setBroadcastOpen(true)} disabled={selectedStaff.length === 0}>
            <Mail className="mr-2 h-4 w-4" />Compose staff broadcast{selectedStaff.length ? ` · ${selectedStaff.length}` : ''}
          </Button>
        ) : null}
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {canCommunicate ? (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all broadcast-eligible staff"
                    checked={allEligibleSelected}
                    onCheckedChange={toggleAllEligible}
                    disabled={eligible.length === 0}
                  />
                </TableHead>
              ) : null}
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead>States</TableHead>
              <TableHead className="text-right">Caseload</TableHead>
              <TableHead className="text-right">Open tasks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={canCommunicate ? 8 : 7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {data?.map((staff) => {
              const eligibleForBroadcast = isBroadcastEligible(staff);
              return (
                <TableRow key={staff.id}>
                  {canCommunicate ? (
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${staff.displayName} for staff broadcast`}
                        checked={selectedIds.has(staff.id)}
                        onCheckedChange={() => toggleSelected(staff.id)}
                        disabled={!eligibleForBroadcast}
                        title={eligibleForBroadcast ? 'Select for staff broadcast' : broadcastIneligibleReason(staff)}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell><div className="font-medium">{staff.displayName}</div><div className="text-xs text-muted-foreground">{staff.email || 'No email address'}</div></TableCell>
                  <TableCell className="text-sm capitalize">{staff.role}</TableCell>
                  <TableCell><Badge variant={staff.lifecycleStatus === 'Inactive' ? 'outline' : 'default'}>{staff.lifecycleStatus ?? staff.status}</Badge></TableCell>
                  <TableCell className="text-sm">{staff.availability}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{staff.states.join(', ')}</TableCell>
                  <TableCell className="text-right tabular-nums">{staff.caseloadCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{staff.openTaskCount}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <StaffBroadcastDialog
        open={broadcastOpen}
        onOpenChange={setBroadcastOpen}
        staff={selectedStaff}
        onComplete={() => setSelectedIds(new Set())}
      />
    </div>
  );
}

function isBroadcastEligible(staff: StaffMember): boolean {
  return Boolean(staff.email.trim()) && staff.lifecycleStatus !== 'Inactive';
}

function broadcastIneligibleReason(staff: StaffMember): string {
  if (!staff.email.trim()) return 'No email address';
  if (staff.lifecycleStatus === 'Inactive') return 'Inactive staff are excluded';
  return 'Not eligible for staff broadcast';
}
