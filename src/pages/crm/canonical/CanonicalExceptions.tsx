import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { useExceptions, useExceptionMutations, useStaffList } from '@/hooks/canonical/useCrmData';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { resolveStaffOperatorLabel } from '@/domain/staffIdentity';

const sevColor: Record<string, string> = {
  Low: 'bg-slate-100 text-slate-700',
  Medium: 'bg-blue-100 text-blue-700',
  High: 'bg-amber-100 text-amber-700',
  Critical: 'bg-red-100 text-red-700',
};

export default function CanonicalExceptions() {
  const query = useExceptions();
  const { isLoading } = query;
  const { capabilities } = useCrmAuth();
  const data = query.isSuccess ? query.data : [];
  const staff = useStaffList();
  const mut = useExceptionMutations();

  const staffOptions = (staff.isSuccess ? staff.data : []).filter((member) => Boolean(member.profileId));

  const pending = mut.resolve.isPending || mut.dismiss.isPending || mut.reassign.isPending || mut.createTask.isPending;
  const mutationError = mut.resolve.error ?? mut.dismiss.error ?? mut.reassign.error ?? mut.createTask.error;

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operational Exceptions</h1>
        <p className="text-sm text-muted-foreground">Automated flags that require human attention</p>
      </div>
      {query.isError && <div role="alert" className="text-destructive">Exceptions could not be loaded. <Button variant="link" onClick={() => void query.refetch()}>Retry exceptions</Button></div>}
      {mutationError && <p role="alert" className="text-destructive">{mutationError.message}</p>}
      {staff.isError && <p role="alert" className="text-destructive">Owner directory unavailable; existing owners are preserved.</p>}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {query.isSuccess && data.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No operational exceptions returned.</TableCell></TableRow>}
            {data?.map(e => {
              const active = e.status === 'Open' || e.status === 'In Review';
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.type}</TableCell>
                  <TableCell><Badge variant="secondary" className={sevColor[e.severity]}>{e.severity}</Badge></TableCell>
                  <TableCell><Badge variant={e.status === 'Open' ? 'destructive' : 'outline'}>{e.status}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-md truncate">{e.summary}</TableCell>
                  <TableCell className="text-sm">
                    {active && capabilities.mutate ? (
                      <Select
                        disabled={pending || staff.isError}
                        value={e.ownerId ?? ''}
                        onValueChange={(ownerId) => mut.reassign.mutate({ id: e.id, ownerId }, { onSuccess: () => toast.success('Reassigned') })}
                      >
                        <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                        <SelectContent>
                          {staffOptions.map((s) => (
                            <SelectItem key={s.profileId} value={s.profileId as string}>{s.displayName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : resolveStaffOperatorLabel(staffOptions, e.ownerId)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(e.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right space-x-2">
                    {active && capabilities.mutate ? (
                      <>
                        <Button disabled={pending} size="sm" variant="outline" onClick={() => mut.createTask.mutate(e.id, { onSuccess: (t) => toast.success(`Task ready: ${t.title}`) })}>
                          Create Task
                        </Button>
                        <Button disabled={pending} size="sm" onClick={() => mut.resolve.mutate({ id: e.id }, { onSuccess: () => toast.success('Resolved') })}>
                          Resolve
                        </Button>
                        <Button disabled={pending} size="sm" variant="ghost" onClick={() => mut.dismiss.mutate({ id: e.id }, { onSuccess: () => toast.success('Dismissed') })}>
                          Dismiss
                        </Button>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
