import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import { AI_OPERATIONS_MODULE_LABELS, AI_OPERATIONS_SNOOZE_PRESETS, dismissAiOperationsFinding, resolveAiOperationsFinding, resolveSnoozeUntil, snoozeAiOperationsFinding } from '@/lib/crm/ai-operations';
import {
  COMMAND_CENTER_CATEGORIES,
  COMMAND_CENTER_CATEGORY_LABELS,
  COMMAND_CENTER_STATUS_LABELS,
  COMMAND_CENTER_VIEWS,
  COMMAND_CENTER_VIEW_LABELS,
  assignFinding,
  fetchCommandCenterAssignees,
  fetchCommandCenterChanges,
  fetchCommandCenterFindings,
  fetchCommandCenterOverview,
  incompleteModules,
  isFindingRecurring,
  reviewFinding,
  sourceLinkFor,
  startFinding,

  type CommandCenterCategory,
  type CommandCenterChangeItem,
  type CommandCenterFinding,
  type CommandCenterView,
} from '@/lib/crm/command-center';

const severityVariant = (severity: string) => (severity === 'critical' || severity === 'high' ? 'destructive' : 'secondary');
const moduleLabel = (module: string) => AI_OPERATIONS_MODULE_LABELS[module as keyof typeof AI_OPERATIONS_MODULE_LABELS] ?? module;
const formatDate = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : '—');
const formatDay = (value: string | null | undefined) => (value ? new Date(`${value}T12:00:00Z`).toLocaleDateString() : '—');

function SourceLink({ finding }: { finding: CommandCenterFinding }) {
  const link = sourceLinkFor(finding.entityType, finding.entityId);
  if (!link) return null;
  return (
    <Button asChild size="sm" variant="outline">
      <Link to={link.path}>{link.label}</Link>
    </Button>
  );
}


type ActionKind = 'resolve' | 'dismiss' | 'review' | 'start' | 'snooze' | 'assign';

function FindingCard({ finding, onAction }: { finding: CommandCenterFinding; onAction: (kind: ActionKind, finding: CommandCenterFinding) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge>
              <Badge variant="outline">{COMMAND_CENTER_CATEGORY_LABELS[finding.category] ?? finding.category}</Badge>
              <Badge variant="secondary">{COMMAND_CENTER_STATUS_LABELS[finding.status] ?? finding.status}</Badge>
              {isFindingRecurring(finding) && <Badge variant="outline">recurring ×{finding.occurrenceCount}</Badge>}
            </div>
            <p className="mt-2 font-medium leading-snug">{finding.title}</p>
            <p className="text-xs text-muted-foreground">
              {moduleLabel(finding.module)} · identified {formatDate(finding.firstDetectedAt)}
              {finding.assignedToEmail ? ` · assigned to ${finding.assignedToEmail}` : ''}
            </p>
            {finding.recommendedAction && <p className="mt-1 text-sm">Next: {finding.recommendedAction}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SourceLink finding={finding} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary">Actions</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onAction('review', finding)}>Mark reviewed</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction('assign', finding)}>Assign</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction('start', finding)}>Start work</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction('snooze', finding)}>Snooze</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction('resolve', finding)}>Resolve</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction('dismiss', finding)}>Dismiss</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="ghost">{open ? 'Less' : 'Details'}</Button>
            </CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent className="mt-3 space-y-2 border-t pt-3 text-sm">
          {finding.summary && <p className="whitespace-pre-wrap">{finding.summary}</p>}
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <div><dt className="inline text-muted-foreground">Last seen: </dt><dd className="inline">{formatDate(finding.lastSeenAt)}</dd></div>
            <div><dt className="inline text-muted-foreground">Occurrences: </dt><dd className="inline">{finding.occurrenceCount}</dd></div>
            <div><dt className="inline text-muted-foreground">Reopened: </dt><dd className="inline">{finding.reopenCount}</dd></div>
            <div><dt className="inline text-muted-foreground">Cycle: </dt><dd className="inline">{formatDay(finding.businessDate)}</dd></div>
            <div><dt className="inline text-muted-foreground">Entity: </dt><dd className="inline">{finding.entityType ?? '—'} {finding.entityId ?? ''}</dd></div>
            <div><dt className="inline text-muted-foreground">Confidence: </dt><dd className="inline">{finding.confidence ?? '—'}</dd></div>
            {finding.snoozedUntil && <div><dt className="inline text-muted-foreground">Snoozed until: </dt><dd className="inline">{formatDate(finding.snoozedUntil)}</dd></div>}
          </dl>
          <p className="text-xs text-muted-foreground">Source module {finding.module} · fingerprint {finding.fingerprint}</p>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ChangeList({ title, description, items }: { title: string; description: string; items: CommandCenterChangeItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title} ({items.length})</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing in this bucket.</p>}
        {items.map((item) => (
          <div key={`${title}-${item.id}`} className="rounded-md border p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>
              <Badge variant="outline">{COMMAND_CENTER_CATEGORY_LABELS[item.category] ?? item.category}</Badge>
              {item.previousSeverity && <span className="text-xs text-muted-foreground">was {item.previousSeverity}</span>}
              {item.occurrenceCount ? <span className="text-xs text-muted-foreground">×{item.occurrenceCount}</span> : null}
            </div>
            <p className="mt-1 leading-snug">{item.title}</p>
            <p className="text-xs text-muted-foreground">{moduleLabel(item.module)} · {formatDate(item.detectedAt ?? item.changedAt ?? item.closedAt ?? item.lastSeenAt)}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function CommandCenterPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<CommandCenterView>('active');
  const [category, setCategory] = useState<CommandCenterCategory | 'all'>('all');
  const [severity, setSeverity] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [module, setModule] = useState<string>('all');
  const [assignedTo, setAssignedTo] = useState<string>('all');
  const [since, setSince] = useState<string>('');
  const [action, setAction] = useState<{ kind: ActionKind; finding: CommandCenterFinding } | null>(null);
  const [reason, setReason] = useState('');
  const [snoozePreset, setSnoozePreset] = useState(AI_OPERATIONS_SNOOZE_PRESETS[0].key);
  const [assignee, setAssignee] = useState('');

  const overview = useQuery({ queryKey: ['command-center', 'overview'], queryFn: () => fetchCommandCenterOverview() });
  const changes = useQuery({ queryKey: ['command-center', 'changes'], queryFn: () => fetchCommandCenterChanges() });
  const assignees = useQuery({ queryKey: ['command-center', 'assignees'], queryFn: fetchCommandCenterAssignees });
  const findings = useQuery({
    queryKey: ['command-center', 'findings', view, category, severity, status, module, assignedTo, since],
    queryFn: () => fetchCommandCenterFindings({
      view,
      category: category === 'all' ? null : category,
      severity: severity === 'all' ? null : severity,
      status: status === 'all' ? null : status,
      module: module === 'all' ? null : module,
      assignedTo: assignedTo === 'all' ? null : assignedTo,
      since: since || null,
      limit: 200,
    }),
  });

  const items = findings.data?.items ?? [];
  const counts = overview.data?.counts;
  const degraded = useMemo(() => incompleteModules(overview.data), [overview.data]);
  const briefSections = overview.data?.brief?.sections ?? [];
  const weekly = overview.data?.weeklyReview;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['command-center'] });
    void queryClient.invalidateQueries({ queryKey: ['ai-operations'] });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!action) return;
      const trimmed = reason.trim();
      if (!trimmed) throw new Error('A reason is required.');
      switch (action.kind) {
        case 'review': return reviewFinding(action.finding.id, trimmed);
        case 'start': return startFinding(action.finding.id, trimmed);
        case 'resolve': return resolveAiOperationsFinding(action.finding.id, trimmed);
        case 'dismiss': return dismissAiOperationsFinding(action.finding.id, trimmed);
        case 'assign': {
          if (!assignee) throw new Error('Select an assignee.');
          return assignFinding(action.finding.id, assignee, trimmed);
        }
        case 'snooze': {
          const until = resolveSnoozeUntil(snoozePreset);
          if (!until) throw new Error('Select a snooze window.');
          return snoozeAiOperationsFinding(action.finding.id, trimmed, until.toISOString());
        }
      }
    },
    onSuccess: () => {
      toast({ title: 'Finding updated' });
      setAction(null);
      setReason('');
      setAssignee('');
      invalidate();
    },
    onError: (error: Error) => toast({ title: 'Action failed', description: error.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Daily Command Center</h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          {' · '}last completed cycle {formatDay(overview.data?.run?.businessDate ?? overview.data?.businessDate)}
          {overview.data?.run ? ` (${overview.data.run.overallStatus})` : ' (not yet run)'}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Open findings', value: counts?.open ?? 0 },
          { label: 'Critical', value: counts?.critical ?? 0 },
          { label: 'High priority', value: counts?.high ?? 0 },
          { label: 'New since yesterday', value: counts?.newSinceYesterday ?? 0 },
          { label: 'Resolved since yesterday', value: counts?.resolvedSinceYesterday ?? 0 },
          { label: 'Recurring', value: counts?.recurring ?? 0 },
          { label: 'Snoozed', value: counts?.snoozed ?? 0 },
          { label: 'Medium / low', value: (counts?.medium ?? 0) + (counts?.low ?? 0) },
        ].map((tile) => (
          <Card key={tile.label}>
            <CardHeader className="pb-2"><CardDescription>{tile.label}</CardDescription></CardHeader>
            <CardContent><p className="text-2xl font-semibold">{tile.value}</p></CardContent>
          </Card>
        ))}
      </section>

      {degraded.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Coverage notices</CardTitle>
            <CardDescription>Some findings may be incomplete for the most recent cycle.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {degraded.map((entry) => (
              <p key={entry.module}>
                {moduleLabel(entry.module)} analysis did not complete ({entry.status}). {moduleLabel(entry.module)} findings may be incomplete.
                {entry.errorSummary ? ` ${entry.errorSummary}` : ''}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Today at ValorWell</CardTitle>
          <CardDescription>
            Daily management summary generated by the existing daily cycle
            {overview.data?.brief?.model ? ` · ${overview.data.brief.model}` : ''}
            {overview.data?.brief?.isPartial ? ' · partial coverage' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {briefSections.length === 0 && <p className="text-muted-foreground">No management summary has been generated yet.</p>}
          {briefSections.map((section, index) => (
            <div key={section.key ?? `${section.heading}-${index}`}>
              <p className="font-medium">{section.heading ?? section.key}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{section.body}</p>
            </div>
          ))}
          {(overview.data?.brief?.everythingNormal ?? []).length > 0 && (
            <p className="text-xs text-muted-foreground">Normal: {overview.data?.brief?.everythingNormal.join(', ')}</p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Needs attention today</h2>
          <Tabs value={view} onValueChange={(value) => setView(value as CommandCenterView)}>
            <TabsList>
              {COMMAND_CENTER_VIEWS.map((entry) => (
                <TabsTrigger key={entry} value={entry}>{COMMAND_CENTER_VIEW_LABELS[entry]}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <Select value={category} onValueChange={(value) => setCategory(value as CommandCenterCategory | 'all')}>
            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {COMMAND_CENTER_CATEGORIES.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {COMMAND_CENTER_CATEGORY_LABELS[entry]}
                  {overview.data?.byCategory?.[entry]?.open ? ` (${overview.data.byCategory[entry].open})` : ''}
                </SelectItem>

              ))}
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {['critical', 'high', 'medium', 'low'].map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(COMMAND_CENTER_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={module} onValueChange={setModule}>
            <SelectTrigger><SelectValue placeholder="Source module" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              {Object.entries(AI_OPERATIONS_MODULE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={assignedTo} onValueChange={setAssignedTo}>
            <SelectTrigger><SelectValue placeholder="Assigned to" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Anyone</SelectItem>
              {(assignees.data ?? []).map((entry) => (
                <SelectItem key={entry.profileId} value={entry.profileId}>{entry.email ?? entry.profileId}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={since} onChange={(event) => setSince(event.target.value)} aria-label="Seen since" />
        </div>

        <div className="space-y-2">
          {findings.isLoading && <p className="text-sm text-muted-foreground">Loading findings…</p>}
          {findings.error && <p className="text-sm text-destructive">{(findings.error as Error).message}</p>}
          {!findings.isLoading && items.length === 0 && <p className="text-sm text-muted-foreground">Nothing requires attention in this view.</p>}
          {items.map((finding) => (
            <FindingCard key={finding.id} finding={finding} onAction={(kind, target) => { setAction({ kind, finding: target }); setReason(''); }} />
          ))}
          {findings.data && findings.data.total > items.length && (
            <p className="text-xs text-muted-foreground">Showing {items.length} of {findings.data.total}. Narrow the filters to see the rest.</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Yesterday → today</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ChangeList title="New" description="Findings that did not exist in the previous cycle." items={changes.data?.new ?? []} />
          <ChangeList title="Worsened" description="Findings whose severity increased." items={changes.data?.worsened ?? []} />
          <ChangeList title="Resolved" description="Closed since the previous cycle." items={changes.data?.resolved ?? []} />
          <ChangeList title="Recurring" description="Repeat problems still open." items={changes.data?.recurring ?? []} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Weekly insights</h2>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Week ending {formatDay(weekly?.weekEnding)}</CardTitle>
            <CardDescription>Most recent completed weekly pattern analysis. Not re-run from this page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!weekly && <p className="text-muted-foreground">No weekly analysis has been generated yet.</p>}
            {weekly?.result?.weekSummary && <p className="whitespace-pre-wrap">{weekly.result.weekSummary}</p>}
            {(weekly?.result?.patterns ?? []).map((pattern, index) => (
              <div key={index} className="rounded-md border p-2">
                <p className="font-medium">{String(pattern.title ?? pattern.pattern ?? `Pattern ${index + 1}`)}</p>
                <p className="text-muted-foreground">{String(pattern.detail ?? pattern.summary ?? pattern.recommendation ?? '')}</p>
              </div>
            ))}
            {(weekly?.result?.gaps ?? []).length > 0 && (
              <p className="text-xs text-muted-foreground">Gaps: {(weekly?.result?.gaps ?? []).join(', ')}</p>
            )}
          </CardContent>
        </Card>
      </section>

      <Dialog open={action !== null} onOpenChange={(open) => { if (!open) setAction(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{action ? `${action.kind} finding` : 'Finding action'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{action?.finding.title}</p>
            {action?.kind === 'assign' && (
              <div className="space-y-1">
                <Label>Assignee</Label>
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger><SelectValue placeholder="Select a person" /></SelectTrigger>
                  <SelectContent>
                    {(assignees.data ?? []).map((entry) => (
                      <SelectItem key={entry.profileId} value={entry.profileId}>{entry.email ?? entry.profileId}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {action?.kind === 'snooze' && (
              <div className="space-y-1">
                <Label>Snooze until</Label>
                <Select value={snoozePreset} onValueChange={setSnoozePreset}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AI_OPERATIONS_SNOOZE_PRESETS.map((preset) => (
                      <SelectItem key={preset.key} value={preset.key}>{preset.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="cc-reason">Reason</Label>
              <Input id="cc-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why are you making this change?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
