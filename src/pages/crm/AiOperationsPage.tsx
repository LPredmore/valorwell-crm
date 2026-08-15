import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AI_OPERATIONS_FLAG_LABELS,
  AI_OPERATIONS_MODULE_LABELS,
  AI_OPERATIONS_SNOOZE_PRESETS,
  type AiOperationsFlagName,
  type AiOperationsFinding,
  dismissAiOperationsFinding,
  fetchAiOperationsBrief,
  fetchAiOperationsFindings,
  fetchAiOperationsFlags,
  fetchAiOperationsOverview,
  fetchAiOperationsRuns,
  resolveAiOperationsFinding,
  resolveSnoozeUntil,
  setAiOperationsFlag,
  snoozeAiOperationsFinding,
} from '@/lib/crm/ai-operations';


const severityVariant = (severity: string) =>
  severity === 'critical' || severity === 'high' ? 'destructive' : 'secondary';

export default function AiOperationsPage() {
  const queryClient = useQueryClient();
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('open');

  const overview = useQuery({
    queryKey: ['ai-operations', 'overview'],
    queryFn: () => fetchAiOperationsOverview(),
    refetchOnWindowFocus: true,
  });
  const brief = useQuery({ queryKey: ['ai-operations', 'brief'], queryFn: () => fetchAiOperationsBrief() });
  const runs = useQuery({ queryKey: ['ai-operations', 'runs'], queryFn: () => fetchAiOperationsRuns(30) });
  const flags = useQuery({ queryKey: ['ai-operations', 'flags'], queryFn: fetchAiOperationsFlags });
  const findings = useQuery({
    queryKey: ['ai-operations', 'findings', moduleFilter, severityFilter, statusFilter],
    queryFn: () => fetchAiOperationsFindings({
      module: moduleFilter === 'all' ? null : moduleFilter,
      severity: severityFilter === 'all' ? null : severityFilter,
      status: statusFilter,
      limit: 100,
    }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['ai-operations'] });

  const flagMutation = useMutation({
    mutationFn: ({ flagName, enabled }: { flagName: string; enabled: boolean }) =>
      setAiOperationsFlag(flagName, enabled, 'Changed from the AI Operations dashboard.'),
    onSuccess: () => { invalidate(); toast({ title: 'Flag updated' }); },
    onError: (error: Error) => toast({ title: 'Could not update the flag', description: error.message, variant: 'destructive' }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'resolve' | 'dismiss' }) =>
      action === 'resolve'
        ? resolveAiOperationsFinding(id, 'Reviewed from the AI Operations dashboard.')
        : dismissAiOperationsFinding(id, 'Dismissed from the AI Operations dashboard.'),
    onSuccess: () => { invalidate(); toast({ title: 'Finding updated' }); },
    onError: (error: Error) => toast({ title: 'Could not update the finding', description: error.message, variant: 'destructive' }),
  });

  const items: AiOperationsFinding[] = findings.data?.items ?? [];
  const counts = overview.data?.findingCounts ?? {};
  const platformEnabled = useMemo(
    () => flags.data?.some((flag) => flag.flagName === 'ai_operations_enabled' && flag.enabled) ?? false,
    [flags.data],
  );

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">AI Operations</h1>
        <p className="text-sm text-muted-foreground">
          Read-only operational intelligence. Findings are recommendations for a human — nothing here changes production data.
        </p>
      </header>

      {!platformEnabled && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">The platform is switched off</CardTitle>
            <CardDescription>
              Enable AI Operations below to start collecting. Modules stay off until you enable them individually.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {(['critical', 'high', 'medium', 'low'] as const).map((severity) => (
          <Card key={severity}>
            <CardHeader className="pb-2">
              <CardDescription className="capitalize">{severity} open</CardDescription>
              <CardTitle className="text-3xl">{counts[severity] ?? 0}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="brief">
        <TabsList>
          <TabsTrigger value="brief">Today's brief</TabsTrigger>
          <TabsTrigger value="findings">Open findings</TabsTrigger>
          <TabsTrigger value="runs">Run history</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
        </TabsList>

        <TabsContent value="brief" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {brief.data ? `Brief for ${brief.data.businessDate}` : 'No brief has been generated yet'}
              </CardTitle>
              {brief.data?.isPartial && (
                <CardDescription>
                  This brief is partial — one or more modules did not complete, so treat coverage as incomplete.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {(brief.data?.sections ?? []).map((section, index) => (
                <div key={section.key ?? index} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{section.heading}</h3>
                    {section.severity && <Badge variant={severityVariant(section.severity)}>{section.severity}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{section.body}</p>
                </div>
              ))}
              {brief.data?.everythingNormal?.length ? (
                <p className="text-sm text-muted-foreground">
                  Normal today: {brief.data.everythingNormal.join(', ')}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="findings" className="space-y-4 pt-4">
          <div className="flex flex-wrap gap-2">
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Module" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modules</SelectItem>
                {Object.entries(AI_OPERATIONS_MODULE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="snoozed">Snoozed</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="divide-y p-0">
              {items.length === 0 && (
                <p className="p-6 text-sm text-muted-foreground">No findings match these filters.</p>
              )}
              {items.map((finding) => (
                <div key={finding.id} className="flex flex-col gap-2 p-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge>
                      <Badge variant="outline">
                        {AI_OPERATIONS_MODULE_LABELS[finding.module as keyof typeof AI_OPERATIONS_MODULE_LABELS] ?? finding.module}
                      </Badge>
                      <span className="font-medium">{finding.title}</span>
                    </div>
                    {finding.summary && <p className="text-sm text-muted-foreground">{finding.summary}</p>}
                    {finding.recommendedAction && (
                      <p className="text-sm">Recommended: {finding.recommendedAction}</p>
                    )}
                    {finding.entityType === 'client' && finding.entityId && (
                      <a className="text-sm underline" href={`/crm/clients/${finding.entityId}`}>Open client</a>
                    )}
                  </div>
                  {finding.status === 'open' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline"
                        onClick={() => actionMutation.mutate({ id: finding.id, action: 'resolve' })}>
                        Resolve
                      </Button>
                      <Button size="sm" variant="ghost"
                        onClick={() => actionMutation.mutate({ id: finding.id, action: 'dismiss' })}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="space-y-4 pt-4">
          <Card>
            <CardContent className="divide-y p-0">
              {(runs.data ?? []).length === 0 && (
                <p className="p-6 text-sm text-muted-foreground">No runs recorded yet.</p>
              )}
              {(runs.data ?? []).map((run) => (
                <div key={run.id} className="space-y-1 p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{run.businessDate}</span>
                    <Badge variant={run.overallStatus === 'success' ? 'secondary' : 'destructive'}>
                      {run.overallStatus}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {run.modules.map((module) => `${module.module}: ${module.status}`).join(' · ') || 'No modules ran.'}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="controls" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Module switches</CardTitle>
              <CardDescription>
                Every switch is off until you enable it. Turning off the platform stops all collection immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(flags.data ?? []).map((flag) => (
                <div key={flag.flagName} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">
                      {AI_OPERATIONS_FLAG_LABELS[flag.flagName as AiOperationsFlagName] ?? flag.flagName}
                    </p>
                    {flag.updatedAt && (
                      <p className="text-xs text-muted-foreground">
                        Updated {new Date(flag.updatedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={flag.enabled}
                    disabled={flagMutation.isPending}
                    onCheckedChange={(enabled) => flagMutation.mutate({ flagName: flag.flagName, enabled })}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
