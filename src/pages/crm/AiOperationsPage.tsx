import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AI_OPERATIONS_FLAG_LABELS,
  AI_OPERATIONS_MODULE_LABELS,
  AI_OPERATIONS_SNOOZE_PRESETS,
  type AiOperationsFlagName,
  type AiOperationsFinding,
  type AiOperationsOverview,
  dismissAiOperationsFinding,
  fetchAiBtyBriefs,
  fetchAiOperationsBrief,
  fetchAiOperationsFindings,
  fetchAiOperationsFlags,
  fetchAiOperationsOverview,
  fetchAiOperationsRuns,
  fetchAiSmokeResults,
  fetchAiOperationsYoutubeComments,
  fetchAiWeeklyReviews,
  isAiOperationsManualModule,
  resolveAiOperationsFinding,
  resolveSnoozeUntil,
  setAiOperationsFlag,
  snoozeAiOperationsFinding,
} from '@/lib/crm/ai-operations';

const severityVariant = (severity: string) => severity === 'critical' || severity === 'high' ? 'destructive' : 'secondary';
const moduleStatusVariant = (status: string) => status === 'success' ? 'secondary' : status === 'running' ? 'outline' : 'destructive';

/** Direct path back to the underlying CRM record a finding was raised against. */
const RECORD_LINKS: Record<string, { path: (id: string) => string; label: string }> = {
  client: { path: (id) => `/crm/clients/${id}`, label: 'Open client' },
  relationship_organization: { path: (id) => `/crm/business-development/organizations/${id}`, label: 'Open organization' },
  relationship_contact: { path: (id) => `/crm/business-development/contacts/${id}`, label: 'Open contact' },
  relationship_opportunity: { path: (id) => `/crm/business-development/opportunities/${id}`, label: 'Open opportunity' },
};

function FindingRecordLink({ entityType, entityId }: { entityType: string | null; entityId: string | null }) {
  const link = entityType ? RECORD_LINKS[entityType] : undefined;
  if (!link || !entityId) return null;
  return <a className="text-sm underline" href={link.path(entityId)}>{link.label}</a>;
}

function evidenceValue(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = '—';
  else if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else {
    try { text = JSON.stringify(value, null, 2); }
    catch { text = String(value); }
  }
  return text.length > 900 ? `${text.slice(0, 900)}…` : text;
}

function evidenceLabel(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (value) => value.toUpperCase());
}

function FindingEvidence({ finding }: { finding: AiOperationsFinding }) {
  if (finding.mode !== 'automatic') return null;
  const evidence = finding.evidence;
  return (
    <details className="mt-2 rounded-md border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">Why this fired</summary>
      <div className="mt-2 space-y-2 text-xs text-muted-foreground">
        {evidence === null || evidence === undefined ? (
          <p>No source-evidence payload is available for this historical finding.</p>
        ) : Array.isArray(evidence) ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{evidenceValue(evidence)}</pre>
        ) : typeof evidence === 'object' ? (
          Object.entries(evidence as Record<string, unknown>).slice(0, 16).map(([key, value]) => (
            <div key={key} className="grid gap-1 sm:grid-cols-[180px_1fr]">
              <span className="font-medium text-foreground">{evidenceLabel(key)}</span>
              <pre className="whitespace-pre-wrap break-words font-sans">{evidenceValue(value)}</pre>
            </div>
          ))
        ) : (
          <pre className="whitespace-pre-wrap">{evidenceValue(evidence)}</pre>
        )}
        {finding.evidenceObservedAt && <p>Evidence observed {new Date(finding.evidenceObservedAt).toLocaleString()}.</p>}
        <p className="font-mono">{finding.fingerprint}</p>
      </div>
    </details>
  );
}

/** Per-module view: this run's coverage plus the module's own open findings. */
function ModuleFindingsPanel({ module, overview }: { module: string; overview: AiOperationsOverview | null }) {
  const label = AI_OPERATIONS_MODULE_LABELS[module as keyof typeof AI_OPERATIONS_MODULE_LABELS] ?? module;
  const run = (overview?.modules ?? []).find((entry) => entry.module === module) ?? null;
  const manual = isAiOperationsManualModule(module);
  const findings = useQuery({
    queryKey: ['ai-operations', 'module-findings', module, manual ? 'manual' : 'automatic'],
    queryFn: () => fetchAiOperationsFindings({ module, status: 'open', mode: manual ? 'manual' : 'automatic', limit: 100 }),
  });
  const items = findings.data?.items ?? [];

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{label}</CardTitle>
            <Badge variant={manual && !run ? 'outline' : moduleStatusVariant(run?.status ?? 'unknown')}>{run?.status ?? (manual ? 'manual' : 'not yet run')}</Badge>
          </div>
          <CardDescription>
            {run
              ? `${run.sourceItemsTotal} source · ${run.itemsAnalyzed} ${manual ? 'analyzed' : 'checked'} · ${run.itemsFailed} failed${run.model ? ` · ${run.model}` : ''}`
              : manual
                ? 'Manual/on-demand analysis; no scheduled model run is expected.'
                : 'This monitoring module has not run for the current business date yet.'}
          </CardDescription>
          {run?.errorSummary && <p className="text-xs text-destructive">{run.errorSummary}</p>}
        </CardHeader>
      </Card>
      <Card><CardContent className="divide-y p-0">
        {findings.isPending && <p className="p-6 text-sm text-muted-foreground">Loading findings…</p>}
        {!findings.isPending && items.length === 0 && <p className="p-6 text-sm text-muted-foreground">No open findings for {label}.</p>}
        {items.map((finding) => (
          <div key={finding.id} className="space-y-1 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge>
              {finding.mode === 'automatic' && <Badge variant="outline">DETERMINISTIC RULE</Badge>}
              <span className="font-medium">{finding.title}</span>
              {finding.mode === 'manual' && finding.confidence !== null && <span className="text-xs text-muted-foreground">confidence {Math.round(finding.confidence * 100)}%</span>}
            </div>
            {finding.summary && <p className="text-sm text-muted-foreground">{finding.summary}</p>}
            {finding.recommendedAction && <p className="text-sm">Recommended: {finding.recommendedAction}</p>}
            <FindingRecordLink entityType={finding.entityType} entityId={finding.entityId} />
            <FindingEvidence finding={finding} />
          </div>
        ))}
      </CardContent></Card>
    </>
  );
}

/** Read-only YouTube review queue. Suggested replies are never posted automatically. */
function YoutubeQueuePanel() {
  const comments = useQuery({ queryKey: ['ai-operations', 'youtube-comments'], queryFn: () => fetchAiOperationsYoutubeComments(null, 50) });
  const items = comments.data?.items ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Comment review queue</CardTitle><CardDescription>Stored YouTube comments remain review-only. AI classification and reply suggestions are manual/on-demand; replies are never posted automatically.</CardDescription></CardHeader>
      <CardContent className="divide-y p-0">
        {comments.isPending && <p className="p-6 text-sm text-muted-foreground">Loading comments…</p>}
        {!comments.isPending && items.length === 0 && <p className="p-6 text-sm text-muted-foreground">No comments have been imported yet.</p>}
        {items.map((comment) => (
          <div key={comment.id} className="space-y-1 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {comment.classification && <Badge variant="outline">{comment.classification}</Badge>}
              {comment.priority && <Badge variant={severityVariant(comment.priority)}>{comment.priority}</Badge>}
              <span className="text-sm font-medium">{comment.authorDisplayName ?? 'Unknown author'}</span>
              <span className="text-xs text-muted-foreground">{comment.videoTitle ?? comment.videoId}</span>
            </div>
            {comment.commentText && <p className="text-sm text-muted-foreground">{comment.commentText}</p>}
            {comment.suggestedReply && <p className="text-sm">Suggested reply: {comment.suggestedReply}</p>}
            <p className="text-xs text-muted-foreground">{comment.reviewState}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function AiOperationsPage() {
  const queryClient = useQueryClient();
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [customSnoozeFindingId, setCustomSnoozeFindingId] = useState<string | null>(null);
  const [customSnoozeValue, setCustomSnoozeValue] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [modeFilter, setModeFilter] = useState<'automatic' | 'manual' | 'all'>('automatic');

  const overview = useQuery({ queryKey: ['ai-operations', 'overview'], queryFn: () => fetchAiOperationsOverview(), refetchOnWindowFocus: true });
  const brief = useQuery({ queryKey: ['ai-operations', 'brief'], queryFn: () => fetchAiOperationsBrief() });
  const runs = useQuery({ queryKey: ['ai-operations', 'runs'], queryFn: () => fetchAiOperationsRuns(30) });
  const smokeResults = useQuery({ queryKey: ['ai-operations', 'smoke-results'], queryFn: () => fetchAiSmokeResults(60) });
  const flags = useQuery({ queryKey: ['ai-operations', 'flags'], queryFn: fetchAiOperationsFlags });
  const weeklyReviews = useQuery({ queryKey: ['ai-operations', 'weekly-reviews'], queryFn: () => fetchAiWeeklyReviews(8) });
  const btyBriefs = useQuery({ queryKey: ['ai-operations', 'bty-briefs'], queryFn: () => fetchAiBtyBriefs(20) });
  const findings = useQuery({
    queryKey: ['ai-operations', 'findings', moduleFilter, severityFilter, statusFilter, modeFilter],
    queryFn: () => fetchAiOperationsFindings({
      module: moduleFilter === 'all' ? null : moduleFilter,
      severity: severityFilter === 'all' ? null : severityFilter,
      status: statusFilter,
      mode: modeFilter,
      limit: 200,
    }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['ai-operations'] });
  const flagMutation = useMutation({
    mutationFn: ({ flagName, enabled }: { flagName: string; enabled: boolean }) => setAiOperationsFlag(flagName, enabled, 'Changed from the ValorWell Daily dashboard.'),
    onSuccess: () => { invalidate(); toast({ title: 'Flag updated' }); },
    onError: (error: Error) => toast({ title: 'Could not update the flag', description: error.message, variant: 'destructive' }),
  });
  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'resolve' | 'dismiss' }) => action === 'resolve'
      ? resolveAiOperationsFinding(id, 'Reviewed from the ValorWell Daily dashboard.')
      : dismissAiOperationsFinding(id, 'Dismissed from the ValorWell Daily dashboard.'),
    onSuccess: () => { invalidate(); toast({ title: 'Finding updated' }); },
    onError: (error: Error) => toast({ title: 'Could not update the finding', description: error.message, variant: 'destructive' }),
  });
  const snoozeMutation = useMutation({
    mutationFn: ({ id, until }: { id: string; until: string }) => snoozeAiOperationsFinding(id, 'Snoozed from the ValorWell Daily dashboard.', until),
    onSuccess: () => { invalidate(); toast({ title: 'Finding snoozed' }); },
    onError: (error: Error) => toast({ title: 'Could not snooze the finding', description: error.message, variant: 'destructive' }),
  });

  const applyPresetSnooze = (id: string, presetKey: string) => {
    const until = resolveSnoozeUntil(presetKey);
    if (until) snoozeMutation.mutate({ id, until: until.toISOString() });
  };
  const submitCustomSnooze = () => {
    if (!customSnoozeFindingId || !customSnoozeValue) return;
    const until = new Date(customSnoozeValue);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
      toast({ title: 'Choose a future date and time', variant: 'destructive' });
      return;
    }
    snoozeMutation.mutate({ id: customSnoozeFindingId, until: until.toISOString() });
    setCustomSnoozeFindingId(null);
    setCustomSnoozeValue('');
  };

  const items: AiOperationsFinding[] = findings.data?.items ?? [];
  const counts = overview.data?.automaticFindingCounts ?? {};
  const manualOpenCount = overview.data?.manualOpenCount ?? 0;
  const platformEnabled = useMemo(() => flags.data?.some((flag) => flag.flagName === 'ai_operations_enabled' && flag.enabled) ?? false, [flags.data]);
  const coverage = brief.data?.coverageManifest ?? {};
  const coverageNumber = (key: string) => Number(coverage[key] ?? 0);

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">ValorWell Daily</h1>
        <p className="text-sm text-muted-foreground">Deterministic operational monitoring runs daily across care, staff, appointments, billing, relationships, SOPs, and system health. Qualitative AI analysis is manual/on-demand. Findings remain human-reviewed.</p>
      </header>

      {!platformEnabled && (
        <Card className="border-dashed"><CardHeader><CardTitle className="text-base">Daily monitoring is switched off</CardTitle><CardDescription>Enable ValorWell Daily monitoring below to resume scheduled deterministic checks. Manual AI analysis remains separate.</CardDescription></CardHeader></Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {(['critical', 'high', 'medium', 'low'] as const).map((severity) => (
          <Card key={severity}><CardHeader className="pb-2"><CardDescription className="capitalize">Automatic {severity} open</CardDescription><CardTitle className="text-3xl">{counts[severity] ?? 0}</CardTitle></CardHeader></Card>
        ))}
      </div>

      <Card className="border-dashed"><CardContent className="py-3 text-sm text-muted-foreground">
        Manual/on-demand backlog: <span className="font-medium text-foreground">{manualOpenCount}</span> open finding(s). These remain available for review but are excluded from automatic morning totals.
      </CardContent></Card>

      <Tabs defaultValue="brief">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="brief">Today</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="system_integrity">System Integrity</TabsTrigger>
          <TabsTrigger value="reliability">Smoke tests</TabsTrigger>
          <TabsTrigger value="client_journey">Client Journey</TabsTrigger>
          <TabsTrigger value="communications">Communications (manual)</TabsTrigger>
          <TabsTrigger value="youtube">YouTube (manual)</TabsTrigger>
          <TabsTrigger value="relationships">Relationships &amp; growth</TabsTrigger>
          <TabsTrigger value="intelligence">Manual intelligence</TabsTrigger>
          <TabsTrigger value="runs">History</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
        </TabsList>

        {(['system_integrity', 'client_journey', 'communications'] as const).map((module) => (
          <TabsContent key={module} value={module} className="space-y-4 pt-4">
            <ModuleFindingsPanel module={module} overview={overview.data ?? null} />
          </TabsContent>
        ))}

        <TabsContent value="reliability" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Critical user-flow smoke tests</CardTitle>
              <CardDescription>Deterministic read-only checks against real production records. A check with nothing to examine reports "not verifiable", never healthy.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {smokeResults.isPending && <p className="p-6 text-sm text-muted-foreground">Loading smoke test results…</p>}
              {!smokeResults.isPending && (smokeResults.data ?? []).length === 0 && <p className="p-6 text-sm text-muted-foreground">Not yet run.</p>}
              {(smokeResults.data ?? []).map((result) => (
                <div key={result.id} className="flex flex-col gap-1 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={result.status === 'failing' || result.status === 'error' ? 'destructive' : result.status === 'unknown' ? 'outline' : 'secondary'}>
                        {result.status === 'unknown' ? 'not verifiable' : result.status}
                      </Badge>
                      <span className="font-medium">{result.display_name}</span>
                      <span className="text-xs text-muted-foreground">{result.domain}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {result.broken_count} broken of {result.source_count} examined · {result.flow_key}
                    </p>
                    {result.error_message && <p className="text-sm text-destructive">{result.error_message}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(result.checked_at).toLocaleString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="relationships" className="space-y-4 pt-4">
          <ModuleFindingsPanel module="relationship_followup" overview={overview.data ?? null} />
          <ModuleFindingsPanel module="donor_intelligence" overview={overview.data ?? null} />
          <ModuleFindingsPanel module="social_leads" overview={overview.data ?? null} />
        </TabsContent>

        <TabsContent value="youtube" className="space-y-4 pt-4">
          <ModuleFindingsPanel module="youtube" overview={overview.data ?? null} />
          <YoutubeQueuePanel />
        </TabsContent>

        <TabsContent value="brief" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{brief.data ? `Daily summary for ${brief.data.businessDate}` : 'No daily summary has been generated yet'}</CardTitle>
              {brief.data?.isPartial && <CardDescription>This summary is partial — one or more enabled automatic monitoring modules did not complete.</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-4">
              {brief.data && (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Automatic open', coverageNumber('automaticOpenFindings')],
                    ['New today', coverageNumber('newToday')],
                    ['Still open from prior days', coverageNumber('stillOpenFromPriorDays')],
                    ['Reopened today', coverageNumber('reopenedToday')],
                    ['Resolved today', coverageNumber('resolvedToday')],
                    ['Overdue / stalled', coverageNumber('agedOrOverdueOpen')],
                    ['Modules completed', `${coverageNumber('modulesHealthy')}/${coverageNumber('modulesExpected')}`],
                    ['Records examined', coverageNumber('recordsExamined')],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-xl font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
              )}
              {(brief.data?.sections ?? []).map((section, index) => (
                <div key={section.key ?? index} className="space-y-1">
                  <div className="flex items-center gap-2"><h3 className="font-medium">{section.heading}</h3>{section.severity && <Badge variant={severityVariant(section.severity)}>{section.severity}</Badge>}</div>
                  <p className="text-sm text-muted-foreground">{section.body}</p>
                </div>
              ))}
              {brief.data?.everythingNormal?.length ? <p className="text-sm text-muted-foreground">No open automatic findings: {brief.data.everythingNormal.map((module) => AI_OPERATIONS_MODULE_LABELS[module as keyof typeof AI_OPERATIONS_MODULE_LABELS] ?? module).join(', ')}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Coverage by module</CardTitle><CardDescription>Unavailable and partial sources remain visible rather than being treated as normal.</CardDescription></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(overview.data?.modules ?? []).map((module) => (
                <div key={module.module} className="flex items-start justify-between gap-2 rounded-md border p-3">
                  <div><p className="text-sm font-medium">{AI_OPERATIONS_MODULE_LABELS[module.module as keyof typeof AI_OPERATIONS_MODULE_LABELS] ?? module.module}</p><p className="text-xs text-muted-foreground">{module.sourceItemsTotal} source · {module.itemsAnalyzed} checked · {module.itemsFailed} failed</p>{module.errorSummary && <p className="mt-1 text-xs text-destructive">{module.errorSummary}</p>}</div>
                  <Badge variant={moduleStatusVariant(module.status)}>{module.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="findings" className="space-y-4 pt-4">
          <div className="flex flex-wrap gap-2">
            <Select value={modeFilter} onValueChange={(value) => setModeFilter(value as 'automatic' | 'manual' | 'all')}><SelectTrigger className="w-52"><SelectValue placeholder="Finding type" /></SelectTrigger><SelectContent><SelectItem value="automatic">Automatic monitoring</SelectItem><SelectItem value="manual">Manual / AI</SelectItem><SelectItem value="all">All findings</SelectItem></SelectContent></Select>
            <Select value={moduleFilter} onValueChange={setModuleFilter}><SelectTrigger className="w-56"><SelectValue placeholder="Module" /></SelectTrigger><SelectContent><SelectItem value="all">All modules</SelectItem>{Object.entries(AI_OPERATIONS_MODULE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}><SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger><SelectContent><SelectItem value="all">All severities</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="snoozed">Snoozed</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="dismissed">Dismissed</SelectItem></SelectContent></Select>
          </div>
          <Card><CardContent className="divide-y p-0">
            {items.length === 0 && <p className="p-6 text-sm text-muted-foreground">No findings match these filters.</p>}
            {items.map((finding) => (
              <div key={finding.id} className="flex flex-col gap-2 p-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2"><Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge><Badge variant="outline">{AI_OPERATIONS_MODULE_LABELS[finding.module as keyof typeof AI_OPERATIONS_MODULE_LABELS] ?? finding.module}</Badge>{finding.mode === 'automatic' && <Badge variant="outline">DETERMINISTIC RULE</Badge>}<span className="font-medium">{finding.title}</span></div>
                  {finding.summary && <p className="text-sm text-muted-foreground">{finding.summary}</p>}
                  {finding.recommendedAction && <p className="text-sm">Recommended: {finding.recommendedAction}</p>}
                  <FindingRecordLink entityType={finding.entityType} entityId={finding.entityId} />
                  <FindingEvidence finding={finding} />
                </div>
                {finding.status === 'open' && <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => actionMutation.mutate({ id: finding.id, action: 'resolve' })}>Resolve</Button>
                  <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline">Snooze</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{AI_OPERATIONS_SNOOZE_PRESETS.map((preset) => <DropdownMenuItem key={preset.key} onSelect={() => applyPresetSnooze(finding.id, preset.key)}>{preset.label}</DropdownMenuItem>)}<DropdownMenuItem onSelect={() => { setCustomSnoozeFindingId(finding.id); setCustomSnoozeValue(''); }}>Custom date and time…</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
                  <Button size="sm" variant="ghost" onClick={() => actionMutation.mutate({ id: finding.id, action: 'dismiss' })}>Dismiss</Button>
                </div>}
                {finding.status === 'snoozed' && finding.snoozedUntil && <span className="text-xs text-muted-foreground">Snoozed until {new Date(finding.snoozedUntil).toLocaleString()}</span>}
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="intelligence" className="space-y-4 pt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Weekly management patterns (manual)</CardTitle></CardHeader><CardContent className="space-y-4">{(weeklyReviews.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No manual weekly review has been generated yet.</p>}{(weeklyReviews.data ?? []).map((review) => <div key={review.id} className="space-y-2 rounded-md border p-3"><div className="flex items-center gap-2"><span className="font-medium">Week ending {review.week_ending}</span></div>{review.structured_result?.weekSummary && <p className="text-sm text-muted-foreground">{review.structured_result.weekSummary}</p>}<p className="text-xs text-muted-foreground">{review.structured_result?.patterns?.length ?? 0} pattern(s)</p></div>)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Beyond The Yellow intelligence (manual)</CardTitle></CardHeader><CardContent className="space-y-4">{(btyBriefs.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No manual BTY AI prep/post-interview brief has been generated.</p>}{(btyBriefs.data ?? []).map((item) => <div key={item.id} className="space-y-2 rounded-md border p-3"><div className="flex items-center gap-2"><Badge variant="outline">{item.brief_type === 'prep' ? 'Interview prep' : 'Post-interview'}</Badge><span className="text-sm">{item.business_date}</span></div>{!item.source_sufficient && <p className="text-xs text-destructive">Source material was insufficient; no fabricated analysis was produced.</p>}<pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(item.structured_result, null, 2)}</pre></div>)}</CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="runs" className="space-y-4 pt-4"><Card><CardContent className="divide-y p-0">
          {(runs.data ?? []).length === 0 && <p className="p-6 text-sm text-muted-foreground">No runs recorded yet.</p>}
          {(runs.data ?? []).map((run) => <div key={run.id} className="space-y-1 p-4"><div className="flex items-center gap-2"><span className="font-medium">{run.businessDate}</span><Badge variant={run.overallStatus === 'success' ? 'secondary' : 'destructive'}>{run.overallStatus}</Badge></div><p className="text-sm text-muted-foreground">{run.modules.map((module) => `${AI_OPERATIONS_MODULE_LABELS[module.module as keyof typeof AI_OPERATIONS_MODULE_LABELS] ?? module.module}: ${module.status}`).join(' · ') || 'No modules ran.'}</p></div>)}
        </CardContent></Card></TabsContent>

        <TabsContent value="controls" className="space-y-4 pt-4"><Card><CardHeader><CardTitle className="text-base">Monitoring and analysis controls</CardTitle><CardDescription>Deterministic monitoring switches control automatic database checks. AI-labeled switches permit manual/on-demand analysis only; no Gemini model worker is scheduled.</CardDescription></CardHeader><CardContent className="space-y-3">
          {(flags.data ?? []).map((flag) => <div key={flag.flagName} className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">{AI_OPERATIONS_FLAG_LABELS[flag.flagName as AiOperationsFlagName] ?? flag.flagName}</p>{flag.updatedAt && <p className="text-xs text-muted-foreground">Updated {new Date(flag.updatedAt).toLocaleString()}</p>}</div><Switch checked={flag.enabled} disabled={flagMutation.isPending} onCheckedChange={(enabled) => flagMutation.mutate({ flagName: flag.flagName, enabled })} /></div>)}
        </CardContent></Card></TabsContent>
      </Tabs>

      <Dialog open={customSnoozeFindingId !== null} onOpenChange={(open) => { if (!open) setCustomSnoozeFindingId(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Snooze until a specific time</DialogTitle></DialogHeader><div className="space-y-2"><Label htmlFor="ai-ops-custom-snooze">Snooze until</Label><Input id="ai-ops-custom-snooze" type="datetime-local" value={customSnoozeValue} onChange={(event) => setCustomSnoozeValue(event.target.value)} /></div><DialogFooter><Button variant="ghost" onClick={() => setCustomSnoozeFindingId(null)}>Cancel</Button><Button onClick={submitCustomSnooze} disabled={!customSnoozeValue || snoozeMutation.isPending}>Snooze</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}
