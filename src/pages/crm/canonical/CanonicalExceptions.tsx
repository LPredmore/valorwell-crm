import { useExceptions, useExceptionMutations } from '@/hooks/canonical/useCrmData';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';

const sevColor: Record<string, string> = {
  Low: 'bg-slate-100 text-slate-700',
  Medium: 'bg-blue-100 text-blue-700',
  High: 'bg-amber-100 text-amber-700',
  Critical: 'bg-red-100 text-red-700',
};

export default function CanonicalExceptions() {
  const { data, isLoading } = useExceptions();
  const mut = useExceptionMutations();

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operational Exceptions</h1>
        <p className="text-sm text-muted-foreground">Automated flags that require human attention</p>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {data?.map(e => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.type}</TableCell>
                <TableCell><Badge variant="secondary" className={sevColor[e.severity]}>{e.severity}</Badge></TableCell>
                <TableCell><Badge variant={e.status === 'Open' ? 'destructive' : 'outline'}>{e.status}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-md truncate">{e.summary}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(e.createdAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right space-x-2">
                  {e.status === 'Open' || e.status === 'In Review' ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => mut.createTask.mutate(e.id, { onSuccess: () => toast.success('Task created') })}>
                        Create Task
                      </Button>
                      <Button size="sm" onClick={() => mut.resolve.mutate({ id: e.id }, { onSuccess: () => toast.success('Resolved') })}>
                        Resolve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => mut.dismiss.mutate({ id: e.id }, { onSuccess: () => toast.success('Dismissed') })}>
                        Dismiss
                      </Button>
                    </>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
