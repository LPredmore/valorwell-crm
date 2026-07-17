import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { useTaskMutations } from '@/hooks/canonical/useCrmData';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import {
  TASK_STATUSES,
  type CrmTask,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from '@/domain/operations';

const TASK_TYPES: TaskType[] = [
  'Client Follow-Up',
  'Staff Follow-Up',
  'Campaign Exception',
  'Eligibility Review',
  'Match Review',
  'Documentation',
  'Risk Intervention',
  'General',
];
const TASK_PRIORITIES: TaskPriority[] = ['Low', 'Normal', 'High', 'Urgent'];

interface TaskFormDialogProps {
  clientId?: string;
  task?: CrmTask;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Phase 16 — Task management dialog (create + edit).
 * Writes carry operating-context tenantId + creator profileId.
 * No direct DB writes: routes through dataProvider.tasks.create/update.
 */
export function TaskFormDialog({
  clientId,
  task,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: TaskFormDialogProps) {
  const qc = useQueryClient();
  const auth = useCrmAuth();
  const { create, update } = useTaskMutations();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const isEdit = !!task;

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [type, setType] = useState<TaskType>(task?.type ?? 'General');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'Normal');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'Not Started');
  const [dueAt, setDueAt] = useState<string>(task?.dueAt?.slice(0, 16) ?? '');

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setType(task?.type ?? 'General');
    setPriority(task?.priority ?? 'Normal');
    setStatus(task?.status ?? 'Not Started');
    setDueAt(task?.dueAt?.slice(0, 16) ?? '');
  }, [open, task]);

  const pending = create.isPending || update.isPending;
  const canSubmit = title.trim().length >= 3 && !pending;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['crm-tasks'] });
  }

  function submit() {
    if (!canSubmit) return;
    const dueIso = dueAt ? new Date(dueAt).toISOString() : undefined;
    if (isEdit && task) {
      update.mutate(
        {
          id: task.id,
          patch: {
            title: title.trim(),
            description: description.trim() || undefined,
            type,
            priority,
            status,
            dueAt: dueIso,
          },
        },
        {
          onSuccess: () => {
            toast.success('Task updated');
            invalidate();
            setOpen(false);
          },
          onError: (err) => toast.error(`Update failed: ${(err as Error).message}`),
        },
      );
      return;
    }

    if (!auth.currentTenantId || !auth.userId) {
      toast.error('Missing operating context — pick a tenant first.');
      return;
    }

    create.mutate(
      {
        tenantId: auth.currentTenantId,
        createdByProfileId: auth.userId,
        clientId,
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        priority,
        status,
        dueAt: dueIso,
        collaboratorIds: [],
        checklist: [],
        tags: [],
      },
      {
        onSuccess: () => {
          toast.success('Task created');
          invalidate();
          setOpen(false);
        },
        onError: (err) => toast.error(`Create failed: ${(err as Error).message}`),
      },
    );
  }

  const canMutate = auth.capabilities.mutate;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== undefined ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={!canMutate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add Task
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Task' : 'New Task'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update task details. Writes route through the canonical tasks repository.'
              : 'Create a task scoped to your current tenant.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Title (required)</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Due</Label>
              <Input
                id="task-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
