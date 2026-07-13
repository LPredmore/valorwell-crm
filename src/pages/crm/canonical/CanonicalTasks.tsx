import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTasks, useTaskMutations } from '@/hooks/canonical/useCrmData';
import type { ListTasksQuery } from '@/repositories/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

const VIEWS: { id: NonNullable<ListTasksQuery['view']>; label: string }[] = [
  { id: 'my', label: 'My Tasks' },
  { id: 'team', label: 'Team' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'due-today', label: 'Due Today' },
  { id: 'due-week', label: 'Due This Week' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'client-followups', label: 'Client Follow-ups' },
  { id: 'staff-followups', label: 'Staff Follow-ups' },
  { id: 'campaign-exceptions', label: 'Campaign Exceptions' },
  { id: 'recently-completed', label: 'Recently Completed' },
  { id: 'all', label: 'All' },
];

const priorityColor: Record<string, string> = {
  Low: 'bg-slate-100 text-slate-700',
  Normal: 'bg-blue-100 text-blue-700',
  High: 'bg-amber-100 text-amber-700',
  Urgent: 'bg-red-100 text-red-700',
};

export default function CanonicalTasks() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as ListTasksQuery['view']) ?? 'overdue';
  const { data, isLoading } = useTasks({ view });
  const mut = useTaskMutations();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clear = () => setSelected(new Set());

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground">Operational task queue</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setParams({ view: v.id })}
            className={`border-b-2 px-3 py-2 text-sm ${view === v.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => { mut.bulkStatus.mutate({ ids: [...selected], status: 'Completed' }, { onSuccess: () => { toast.success('Marked complete'); clear(); } }); }}>
            Mark Complete
          </Button>
          <Button size="sm" variant="ghost" onClick={clear}>Clear</Button>
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Owner</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {data?.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No tasks in this view.</TableCell></TableRow>}
            {data?.map(t => (
              <TableRow key={t.id}>
                <TableCell><Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} /></TableCell>
                <TableCell><div className="font-medium">{t.title}</div>{t.description && <div className="text-xs text-muted-foreground line-clamp-1">{t.description}</div>}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.type}</TableCell>
                <TableCell><Badge variant="secondary" className={priorityColor[t.priority]}>{t.priority}</Badge></TableCell>
                <TableCell className="text-sm">{t.status}</TableCell>
                <TableCell className="text-sm">{t.dueAt ? new Date(t.dueAt).toLocaleDateString() : '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.ownerId ?? 'Unassigned'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
