import {Link} from 'react-router-dom';
import {useCrmAuth} from '@/hooks/crm/useCrmAuth';
import {TaskFormDialog} from '@/components/crm/canonical/TaskFormDialog';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStaffList, useTasks, useTaskMutations } from '@/hooks/canonical/useCrmData';
import { resolveStaffOperatorLabel } from '@/domain/staffIdentity';
import type { ListTasksQuery } from '@/repositories/types';
import { readTaskWorkspaceFilters, TASK_PRIORITIES } from '@/domain/taskWorkspaceFilters';
import { TASK_STATUSES } from '@/domain/operations';
import { Input } from '@/components/ui/input';
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
  const {currentTenantId,userId,crmRole}=useCrmAuth();
  const [params]=useSearchParams();
  return <CanonicalTaskWorkspace key={`${currentTenantId}:${userId}:${crmRole}:${params.toString()}`}/>;
}
function CanonicalTaskWorkspace() {
  const {capabilities}=useCrmAuth();
  const [params, setParams] = useSearchParams();
  const filters = readTaskWorkspaceFilters(params);
  const { view, page } = filters;
  const [search, setSearch] = useState(filters.search);
  const updateFilter = (key: string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    return next;
  });
  const tasks=useTasks({view, page, pageSize:50, search:filters.search,
    statuses:filters.status?[filters.status]:undefined,
    priorities:filters.priority?[filters.priority]:undefined,
    ownerIds:filters.owner?[filters.owner]:undefined,
  });
  const {data,isLoading}=tasks;
  const { data: staff = [] } = useStaffList();
  const mut = useTaskMutations();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clear = () => setSelected(new Set());

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground">Operational task queue</p></div>
        {capabilities.mutate&&<TaskFormDialog/>}
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {VIEWS.map(v => (
          <button key={v.id} aria-pressed={view===v.id} onClick={() => updateFilter('view', v.id)}
            className={`border-b-2 px-3 py-2 text-sm ${view === v.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {v.label}
          </button>
        ))}
      </div>

      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); updateFilter('q', search.trim()); }}>
        <Input className="sm:max-w-sm" aria-label="Search tasks" placeholder="Search task title or description" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} />
        <Button type="submit">Search</Button>
        <select aria-label="Task status" className="rounded border bg-background p-2" value={filters.status??''} onChange={event=>updateFilter('status',event.target.value)}>
          <option value="">All statuses in this view</option>
          {TASK_STATUSES.map(status=><option key={status} value={status}>{status}</option>)}
        </select>
        <select aria-label="Task priority" className="rounded border bg-background p-2" value={filters.priority??''} onChange={event=>updateFilter('priority',event.target.value)}>
          <option value="">All priorities</option>
          {TASK_PRIORITIES.map(priority=><option key={priority} value={priority}>{priority}</option>)}
        </select>
        <select aria-label="Task owner" className="max-w-xs rounded border bg-background p-2" value={filters.owner} onChange={event=>updateFilter('owner',event.target.value)}>
          <option value="">All owners in this view</option>
          {filters.owner&&!staff.some(person=>person.profileId===filters.owner)&&<option value={filters.owner}>Selected owner (name unavailable)</option>}
          {staff.filter(person=>person.profileId).map(person=><option key={person.id} value={person.profileId}>{resolveStaffOperatorLabel(staff,person.profileId)}</option>)}
        </select>
        <Button type="button" variant="ghost" onClick={()=>setParams(previous=>{
          const next=new URLSearchParams(previous);for(const key of ['q','status','priority','owner','page'])next.delete(key);return next;
        })}>Clear filters</Button>
      </form>
      <p className="text-xs text-muted-foreground">Filters narrow the selected view. Each page contains up to 50 tasks; the displayed count is not a workspace total.</p>

      {capabilities.mutate&&!tasks.isError&&selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm">{selected.size} selected</span>
          <Button size="sm" variant="outline" disabled={mut.bulkStatus.isPending} onClick={() => { mut.bulkStatus.mutate({ ids: [...selected], status: 'Completed' }, { onSuccess: () => { toast.success('Marked complete'); clear(); },onError:()=>toast.error('Could not complete the selected tasks. Refresh and retry.') }); }}>
            Mark Complete
          </Button>
          <Button size="sm" variant="ghost" onClick={clear}>Clear</Button>
        </div>
      )}

      {tasks.isError&&<div role="alert" className="space-y-2"><p className="text-sm text-destructive">Tasks could not be loaded.</p><Button variant="outline" onClick={()=>void tasks.refetch()}>Retry tasks</Button></div>}
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
              {capabilities.mutate&&<TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={capabilities.mutate?8:7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!tasks.isError&&!isLoading&&data?.length === 0 && <TableRow><TableCell colSpan={capabilities.mutate?8:7} className="py-8 text-center text-muted-foreground">No tasks in this view.</TableCell></TableRow>}
            {!tasks.isError&&data?.map(t => (
              <TableRow key={t.id}>
                <TableCell>{capabilities.mutate&&<Checkbox aria-label={`Select ${t.title}`} disabled={t.status==='Completed'||t.status==='Canceled'||mut.bulkStatus.isPending} checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} />}</TableCell>
                <TableCell><div className="font-medium">{t.title}</div>{t.description && <div className="text-xs text-muted-foreground line-clamp-1">{t.description}</div>}
                  {t.relationshipContactId&&<Link className="text-xs text-primary underline" to={`/crm/business-development/contacts/${t.relationshipContactId}`}>Open relationship contact</Link>}
                  {t.relationshipOrganizationId&&<Link className="text-xs text-primary underline" to={`/crm/business-development/organizations/${t.relationshipOrganizationId}`}>Open organization</Link>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.type}</TableCell>
                <TableCell><Badge variant="secondary" className={priorityColor[t.priority]}>{t.priority}</Badge></TableCell>
                <TableCell className="text-sm">{t.status}</TableCell>
                <TableCell className="text-sm">{t.dueAt ? new Date(t.dueAt).toLocaleString() : '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{resolveStaffOperatorLabel(staff, t.ownerId)}</TableCell>
                {capabilities.mutate&&<TableCell><TaskFormDialog task={t} trigger={<Button size="sm" variant="outline" aria-label={`Edit ${t.title}`}>Edit task</Button>}/></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {!tasks.isError&&<div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={page<=1||tasks.isFetching} onClick={()=>updateFilter('page',String(page-1))}>Previous page</Button>
        <span className="text-sm">Page {page} · {data?.length??0} loaded tasks</span>
        <Button variant="outline" disabled={tasks.isFetching||(data?.length??0)<50} onClick={()=>updateFilter('page',String(page+1))}>Next page</Button>
      </div>}
    </div>
  );
}
