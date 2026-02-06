import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { StaffStatusBadge } from './StaffStatusBadge';
import type { CrmStaff } from '@/lib/crm/staff-types';

interface StaffTableProps {
  staff: CrmStaff[];
  isLoading: boolean;
  selectedStaffIds: Set<string>;
  onSelectionChange: (staffId: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
}

export function StaffTable({
  staff,
  isLoading,
  selectedStaffIds,
  onSelectionChange,
  onSelectAll,
}: StaffTableProps) {
  const allSelected = staff.length > 0 && staff.every(s => selectedStaffIds.has(s.id));
  const someSelected = staff.some(s => selectedStaffIds.has(s.id)) && !allSelected;

  const getDisplayName = (s: CrmStaff) => {
    const fullName = [s.prov_name_f, s.prov_name_l].filter(Boolean).join(' ');
    return fullName || s.prov_name_for_clients || 'Unknown';
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (staff.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No staff members found
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            <TableHead className="w-12">
              <Checkbox
                checked={allSelected}
                ref={(el) => {
                  if (el) {
                    (el as unknown as HTMLInputElement).indeterminate = someSelected;
                  }
                }}
                onCheckedChange={(checked) => onSelectAll(checked === true)}
                aria-label="Select all staff"
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {staff.map(staffMember => (
            <TableRow key={staffMember.id} data-state={selectedStaffIds.has(staffMember.id) ? 'selected' : undefined}>
              <TableCell>
                <Checkbox
                  checked={selectedStaffIds.has(staffMember.id)}
                  onCheckedChange={(checked) => onSelectionChange(staffMember.id, checked === true)}
                  aria-label={`Select ${getDisplayName(staffMember)}`}
                />
              </TableCell>
              <TableCell className="font-medium">
                {getDisplayName(staffMember)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {staffMember.email || '—'}
              </TableCell>
              <TableCell>
                <StaffStatusBadge status={staffMember.prov_status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {staffMember.prov_state || '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
