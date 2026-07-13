import { useStaffList } from '@/hooks/canonical/useCrmData';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function CanonicalStaff() {
  const { data, isLoading } = useStaffList();
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
        <p className="text-sm text-muted-foreground">Clinicians, operations, admins</p>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
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
            {isLoading && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {data?.map(s => (
              <TableRow key={s.id}>
                <TableCell><div className="font-medium">{s.displayName}</div><div className="text-xs text-muted-foreground">{s.email}</div></TableCell>
                <TableCell className="text-sm capitalize">{s.role}</TableCell>
                <TableCell><Badge variant={s.status === 'Active' ? 'default' : 'outline'}>{s.status}</Badge></TableCell>
                <TableCell className="text-sm">{s.availability}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.states.join(', ')}</TableCell>
                <TableCell className="text-right tabular-nums">{s.caseloadCount}</TableCell>
                <TableCell className="text-right tabular-nums">{s.openTaskCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
