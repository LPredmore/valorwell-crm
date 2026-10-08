import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import type { TaskPriority } from '@/domain/operations';
import {
  relationshipTasksRepository, RelationshipTasksNotDeployedError, statusLabels,
  type RelationshipTaskRow, type RelationshipTaskSubject,
} from '@/repositories/supabase/relationship-tasks';
import { dataProvider } from '@/services/dataProvider';

const priorityOptions: TaskPriority[] = ['Low', 'Normal', 'High', 'Urgent'];

function formatDue(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'No deadline';
}
function isOverdue(task: RelationshipTaskRow) {
  return task.due_at !== null && new Date(task.due_at).getTime() < Date.now()
    && task.status !== 'completed' && task.status !== 'canceled';
}

export function RelationshipTasksPanel({ subject }: { subject: RelationshipTaskSubject }) {
  const { currentTenantId, capabilities, userId } = useCrmAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('Normal');
  const [ownerId, setOwnerId] = useState(userId);
  const [due, setDue] = useState('');
  const [view, setView] = useState<'open' | 'overdue' | 'all'>('open');
  const subjectKey = subject.contactId ? 'contact:' + subject.contactId : 'organization:' + subject.organizationId;
  const key = ['relationship-tasks', currentTenantId, subjectKey];
  const query = useQuery({
    queryKey: key,
    queryFn: () => relationshipTasksRepository.list(subject),
    enabled: !!currentTenantId, retry: false,
  });
  const team = useQuery({
    queryKey: ['relationship-task-assignees', currentTenantId],
    queryFn: () => dataProvider.staff.list(currentTenantId!),
    enabled: !!currentTenantId && capabilities.mutate, retry: false,
  });
  const create = useMutation({
    mutationFn: () => relationshipTasksRepository.create(subject, {
      title, description, priority, ownerId, dueAt: due ? new Date(due).toISOString() : undefined,
    }),
    onSuccess: async () => {
      setTitle(''); setDescription(''); setDue('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
    },
  });
  const update = useMutation({
    mutationFn: ({ task, complete, patch }: {
      task: RelationshipTaskRow; complete?: boolean;
      patch?: { ownerId?: string | null; dueAt?: string | null; priority?: TaskPriority };
    }) => complete ? relationshipTasksRepository.complete(task) : relationshipTasksRepository.update(task, patch ?? {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
    },
  });
  const rows = (query.data ?? []).filter(row => view === 'all' || (view === 'overdue' ? isOverdue(row)
    : row.status !== 'completed' && row.status !== 'canceled'));
  const missing = query.error instanceof RelationshipTasksNotDeployedError;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Follow-up tasks</CardTitle>
        <CardDescription>
          Tasks are stored in the existing CRM task system, linked to this non-clinical record.
          Completion and ownership changes update the same underlying task seen in My Tasks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {missing && <p role="status" className="rounded border p-3 text-sm">
          Relationship task subjects are not yet available in Billing Hub. The database migration is required.
        </p>}
        {query.isError && !missing && <p role="alert" className="text-sm text-destructive">
          Task list unavailable: {query.error instanceof Error ? query.error.message : 'Unauthorized'}
        </p>}
        {!query.isError && <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Task status filter">
            {(['open', 'overdue', 'all'] as const).map(v => (
              <Button key={v} size="sm" variant={view === v ? 'default' : 'outline'} onClick={() => setView(v)}>
                {v === 'open' ? 'Open' : v === 'overdue' ? 'Overdue' : 'All'}
              </Button>
            ))}
          </div>
          {query.isLoading && <p className="text-sm text-muted-foreground">Loading tasks…</p>}
          {rows.length === 0 && !query.isLoading &&
            <p className="text-sm text-muted-foreground">No {view === 'all' ? '' : view + ' '}tasks for this record.</p>}
          <div className="divide-y rounded border">
            {rows.map(task => <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="space-y-1">
                <p className="font-medium">{task.title}</p>
                {task.description && <p className="text-sm text-muted-foreground">{task.description}</p>}
                <p className="text-xs text-muted-foreground">{formatDue(task.due_at)} · {task.owner_id ? 'Owner: ' + task.owner_id : 'Unassigned'}</p>
                <div className="flex gap-2"><Badge variant={isOverdue(task) ? 'destructive' : 'outline'}>{statusLabels[task.status]}</Badge>
                  <Badge variant="outline">{task.priority}</Badge></div>
              </div>
              {capabilities.mutate && task.status !== 'completed' && task.status !== 'canceled' &&
                <Button variant="outline" size="sm" disabled={update.isPending} onClick={() => update.mutate({ task, complete: true })}>
                  Complete task
                </Button>}
            </div>)}
          </div>
        </>}
        {update.isError && <p role="alert" className="text-sm text-destructive">
          {update.error instanceof Error ? update.error.message : 'Task update failed.'}
        </p>}
        {capabilities.mutate && !query.isError && <div className="space-y-3 border-t pt-4">
          <h3 className="font-medium">Create follow-up</h3>
          <div className="space-y-1"><Label htmlFor={`task-title-${subjectKey}`}>Task</Label>
            <Input id={`task-title-${subjectKey}`} value={title} maxLength={200}
              onChange={e => setTitle(e.target.value)} placeholder="Follow up after interview" /></div>
          <div className="space-y-1"><Label htmlFor={`task-desc-${subjectKey}`}>Notes (non-clinical)</Label>
            <Textarea id={`task-desc-${subjectKey}`} value={description}
              onChange={e => setDescription(e.target.value)} placeholder="Next steps only — no clinical information" /></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label htmlFor={`task-owner-${subjectKey}`}>Assigned owner</Label>
              <select id={`task-owner-${subjectKey}`} value={ownerId} onChange={e => setOwnerId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value={userId}>Me</option>
                <option value="">Unassigned</option>
                {team.data?.filter(x => x.profileId && x.profileId !== userId).map(x =>
                  <option key={x.profileId} value={x.profileId}>{x.displayName}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label htmlFor={`task-priority-${subjectKey}`}>Priority</Label>
              <select id={`task-priority-${subjectKey}`} value={priority} onChange={e => setPriority(e.target.value as TaskPriority)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {priorityOptions.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label htmlFor={`task-due-${subjectKey}`}>Due (local time)</Label>
              <Input id={`task-due-${subjectKey}`} type="datetime-local" value={due} onChange={e => setDue(e.target.value)} />
            </div>
          </div>
          {create.isError && <p role="alert" className="text-sm text-destructive">
            {create.error instanceof Error ? create.error.message : 'Task creation failed.'}</p>}
          <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create task'}
          </Button>
        </div>}
      </CardContent>
    </Card>
  );
}
