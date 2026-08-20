import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, FileText, PauseCircle, PlayCircle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCanMutate } from '@/hooks/crm/useCanMutate';
import {
  MarketingNewsletterEmailStudioComposer,
  type MarketingNewsletterEmailStudioHandle,
} from '@/features/email-studio/newsletter';
import type { EmailContentDocument } from '@/features/email-studio/contracts';
import {
  getEmailTemplate,
  listEmailTemplates,
  publishEmailTemplate,
  saveEmailTemplateDraft,
} from '@/features/email-studio/templates/api';
import {
  NEWSLETTER_AUDIENCE_DOMAINS,
  NEWSLETTER_AUDIENCE_LABELS,
  cancelNewsletterSend,
  cloneNewsletterToDraft,
  detailToCanonicalContent,
  getNewsletter,
  getNewsletterDeliveryTrace,
  getNewsletterRuntime,
  listNewsletters,
  previewNewsletterAudience,
  scheduleNewsletter,
  suppressNewsletterMailbox,
  unsuppressNewsletterMailbox,
  upsertCanonicalNewsletter,
  type NewsletterAudienceDomain,
  type NewsletterRuntime,
  type NewsletterSummary,
} from '@/lib/crm/newsletters';

const EMPTY_AUDIENCES: NewsletterAudienceDomain[] = ['client'];

type ComposerState = {
  newsletterId: string | null;
  name: string;
  subject: string;
  audienceDomains: NewsletterAudienceDomain[];
  reason: string;
  initialContent: EmailContentDocument | null;
  templateId: string | null;
  templateVersionId: string | null;
};

function emptyComposer(): ComposerState {
  return {
    newsletterId: null,
    name: '',
    subject: '',
    audienceDomains: [...EMPTY_AUDIENCES],
    reason: '',
    initialContent: null,
    templateId: null,
    templateVersionId: null,
  };
}

function statusVariant(status: string) {
  if (status === 'sending') return 'default' as const;
  if (status === 'completed') return 'secondary' as const;
  if (status === 'cancelled') return 'destructive' as const;
  return 'outline' as const;
}

export default function NewsletterManagementPage() {
  const canMutate = useCanMutate();
  const queryClient = useQueryClient();
  const editorRef = useRef<MarketingNewsletterEmailStudioHandle>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [scheduleAt, setScheduleAt] = useState<Record<string, string>>({});
  const [traceNewsletterId, setTraceNewsletterId] = useState<string | null>(null);
  const [suppressEmail, setSuppressEmail] = useState('');
  const [suppressReason, setSuppressReason] = useState('');
  const [restoreEmail, setRestoreEmail] = useState('');
  const [restoreReason, setRestoreReason] = useState('');

  const runtime = useQuery({ queryKey: ['newsletter-runtime'], queryFn: getNewsletterRuntime, retry: false });
  const newsletters = useQuery({ queryKey: ['newsletters'], queryFn: listNewsletters, retry: false });
  const templates = useQuery({
    queryKey: ['email-studio', 'marketing-newsletter-templates'],
    queryFn: () => listEmailTemplates({ status: 'published', scope: 'marketing_newsletter' }),
    retry: false,
  });
  const trace = useQuery({
    queryKey: ['newsletter-trace', traceNewsletterId],
    queryFn: () => getNewsletterDeliveryTrace(traceNewsletterId as string),
    enabled: Boolean(traceNewsletterId),
    retry: false,
  });

  const audienceKey = composer?.audienceDomains.slice().sort().join(',') ?? '';
  const audiencePreview = useQuery({
    queryKey: ['newsletter-audience-preview', audienceKey],
    queryFn: () => previewNewsletterAudience(
      audienceKey ? audienceKey.split(',') as NewsletterAudienceDomain[] : [],
    ),
    enabled: Boolean(composer) && audienceKey.length > 0,
    retry: false,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['newsletters'] });
    void queryClient.invalidateQueries({ queryKey: ['newsletter-trace'] });
    void queryClient.invalidateQueries({ queryKey: ['newsletter-runtime'] });
  };

  const save = useMutation({
    mutationFn: async (state: ComposerState) => {
      const content = await editorRef.current?.exportContent();
      if (!content) throw new Error('Export valid canonical Email Studio content before saving.');
      return upsertCanonicalNewsletter({
        newsletterId: state.newsletterId,
        name: state.name.trim(),
        subject: state.subject.trim(),
        content,
        audienceDomains: state.audienceDomains,
        reason: state.reason.trim(),
        templateVersionId: state.templateVersionId,
      });
    },
    onSuccess: () => {
      setComposer(null);
      refresh();
    },
  });

  const saveTemplate = useMutation({
    mutationFn: async (state: ComposerState) => {
      const content = await editorRef.current?.exportContent();
      if (!content) throw new Error('Export valid canonical Email Studio content before publishing a template.');
      const saved = await saveEmailTemplateDraft({
        name: state.name.trim(),
        description: 'Reusable marketing newsletter template.',
        subject: state.subject.trim(),
        scope: 'marketing_newsletter',
        content,
      });
      return publishEmailTemplate(saved.id, state.reason.trim() || 'Published from Newsletter Management');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email-studio', 'marketing-newsletter-templates'] });
    },
  });

  const loadTemplate = useMutation({
    mutationFn: async (templateId: string) => getEmailTemplate(templateId),
    onSuccess: (template) => {
      if (!composer || template.scope !== 'marketing_newsletter' || template.mode !== 'newsletter'
          || !template.editorDocument || !template.schemaVersion || !template.renderHash) return;
      setComposer({
        ...composer,
        subject: composer.subject || template.subject,
        templateId: template.id,
        templateVersionId: template.currentPublishedVersionId,
        initialContent: {
          schemaVersion: template.schemaVersion,
          mode: 'newsletter',
          editorDocument: template.editorDocument,
          renderedHtml: template.renderedHtml,
          renderedText: template.renderedText,
          preheader: template.preheader,
          themeKey: template.themeKey,
          renderHash: template.renderHash,
        },
      });
    },
  });

  const schedule = useMutation({
    mutationFn: (newsletterId: string) => scheduleNewsletter({
      newsletterId,
      scheduledAt: scheduleAt[newsletterId] ? new Date(scheduleAt[newsletterId]).toISOString() : null,
      reason: reasons[newsletterId] ?? '',
    }),
    onSuccess: refresh,
  });

  const cancelSend = useMutation({
    mutationFn: (newsletterId: string) => cancelNewsletterSend({
      newsletterId,
      reason: reasons[newsletterId] ?? '',
    }),
    onSuccess: refresh,
  });

  const revise = useMutation({
    mutationFn: (letter: NewsletterSummary) => cloneNewsletterToDraft({
      newsletterId: letter.id,
      name: `${letter.name} — Revision`,
      reason: reasons[letter.id] ?? '',
    }),
    onSuccess: async (result) => {
      const detail = await getNewsletter(result.newsletterId);
      setComposer({
        newsletterId: detail.id,
        name: detail.name,
        subject: detail.subject ?? '',
        audienceDomains: detail.audienceDomains.length ? detail.audienceDomains : [...EMPTY_AUDIENCES],
        reason: '',
        initialContent: detailToCanonicalContent(detail),
        templateId: null,
        templateVersionId: detail.templateVersionId,
      });
      refresh();
    },
  });

  const suppress = useMutation({
    mutationFn: () => suppressNewsletterMailbox({
      email: suppressEmail.trim(),
      reason: suppressReason.trim(),
    }),
    onSuccess: () => {
      setSuppressEmail('');
      setSuppressReason('');
      refresh();
    },
  });

  const unsuppress = useMutation({
    mutationFn: () => unsuppressNewsletterMailbox({
      email: restoreEmail.trim(),
      reason: restoreReason.trim(),
    }),
    onSuccess: () => {
      setRestoreEmail('');
      setRestoreReason('');
      refresh();
    },
  });

  const openExisting = useMutation({
    mutationFn: (newsletterId: string) => getNewsletter(newsletterId),
    onSuccess: (detail) => {
      if (detail.status !== 'draft') return;
      setComposer({
        newsletterId: detail.id,
        name: detail.name,
        subject: detail.subject ?? '',
        audienceDomains: detail.audienceDomains.length ? detail.audienceDomains : [...EMPTY_AUDIENCES],
        reason: '',
        initialContent: detailToCanonicalContent(detail),
        templateId: null,
        templateVersionId: detail.templateVersionId,
      });
    },
  });

  const rows: NewsletterSummary[] = useMemo(() => newsletters.data?.newsletters ?? [], [newsletters.data]);
  const runtimeState = runtime.data?.state ?? 'PRELAUNCH';
  const deliveryActive = runtimeState === 'ACTIVE';

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Newsletters</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Author mailbox-safe marketing newsletters in Email Studio, preview the eligible audience, and preserve an immutable recipient snapshot when delivery is activated.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild variant="outline"><Link to="/crm/email-studio">Email Studio templates</Link></Button>
        <Button disabled={!canMutate} onClick={() => setComposer(emptyComposer())}>New newsletter</Button>
      </div>
    </div>

    <RuntimeCard runtime={runtime.data} loading={runtime.isLoading} error={runtime.error} />

    <Card>
      <CardHeader>
        <CardTitle>All newsletters</CardTitle>
        <CardDescription>
          {newsletters.data?.suppressedMailboxes ?? 0} active marketing-newsletter mailbox suppressions. Suppression does not affect transactional, clinical, recruiting, campaign, or staff-operational email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {newsletters.isLoading && <p className="text-sm text-muted-foreground">Loading newsletters…</p>}
        {newsletters.isError && <p className="text-sm text-destructive">{newsletters.error instanceof Error ? newsletters.error.message : 'Newsletters unavailable.'}</p>}
        {rows.length === 0 && !newsletters.isLoading && !newsletters.isError && <p className="text-sm text-muted-foreground">No newsletters yet. Create a canonical draft to get started.</p>}

        {rows.map((letter) => {
          const reason = reasons[letter.id] ?? '';
          return <div className="space-y-3 rounded-md border p-3" key={letter.id}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{letter.name}</span>
              <Badge variant={statusVariant(letter.status)}>{letter.status}</Badge>
              <Badge variant={letter.canonical ? 'secondary' : 'destructive'}>{letter.canonical ? 'canonical' : 'legacy draft'}</Badge>
              {letter.audienceDomains.map((domain) => <Badge key={domain} variant="outline">{NEWSLETTER_AUDIENCE_LABELS[domain] ?? domain}</Badge>)}
              {letter.scheduledAt && <span className="text-muted-foreground">scheduled {new Date(letter.scheduledAt).toLocaleString()}</span>}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{letter.queued} pending</Badge>
              {letter.processing > 0 && <Badge variant="outline">{letter.processing} processing</Badge>}
              <Badge variant="outline">{letter.sent} sent</Badge>
              {letter.failed > 0 && <Badge variant="destructive">{letter.failed} failed</Badge>}
              <Badge variant="secondary">{letter.suppressed} suppressed</Badge>
              {letter.skipped > 0 && <Badge variant="secondary">{letter.skipped} skipped</Badge>}
            </div>
            {letter.subject && <p className="text-sm text-muted-foreground">Subject: {letter.subject}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setTraceNewsletterId((current) => current === letter.id ? null : letter.id)} size="sm" variant="ghost">
                {traceNewsletterId === letter.id ? 'Hide delivery trace' : 'Delivery trace'}
              </Button>
              {canMutate && letter.status === 'draft' && <Button disabled={openExisting.isPending} onClick={() => openExisting.mutate(letter.id)} size="sm" variant="outline">
                Edit draft
              </Button>}
            </div>

            {canMutate && letter.status !== 'completed' && letter.status !== 'cancelled' && <div className="flex flex-wrap items-end gap-2 rounded border bg-muted/30 p-3">
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor={`reason-${letter.id}`}>Reason for this action</Label>
                <Input
                  id={`reason-${letter.id}`}
                  onChange={(event) => setReasons((current) => ({ ...current, [letter.id]: event.target.value }))
                  placeholder="Audit reason"
                  value={reason}
                />
              </div>
              {letter.status === 'draft' && <div className="space-y-1">
                <Label htmlFor={`when-${letter.id}`}>Send at (optional)</Label>
                <Input
                  id={`when-${letter.id}`}
                  onChange={(event) => setScheduleAt((current) => ({ ...current, [letter.id]: event.target.value }))
                  type="datetime-local"
                  value={scheduleAt[letter.id] ?? ''}
                />
              </div>}
              {letter.status === 'draft' && <Button
                disabled={!deliveryActive || !letter.canonical || !reason.trim() || schedule.isPending}
                onClick={() => schedule.mutate(letter.id)}
                size="sm"
              >
                {scheduleAt[letter.id] ? 'Schedule send' : 'Send now'}
              </Button>}
              {letter.status === 'scheduled' || letter.status === 'sending' ? <Button
                disabled={!reason.trim() || cancelSend.isPending}
                onClick={() => cancelSend.mutate(letter.id)}
                size="sm"
                variant="destructive"
              >
                Cancel remaining
              </Button> : null}
              {letter.status !== 'draft' && <Button
                disabled={!reason.trim() || revise.isPending}
                onClick={() => revise.mutate(letter)}
                size="sm"
                variant="outline"
              ><Copy className="mr-2 h-4 w-4" />Revise as draft</Button>}
              {letter.status === 'draft' && !deliveryActive && <p className="w-full text-xs text-muted-foreground">Delivery is {runtimeState}. Draft authoring and audience preview remain available; scheduling is intentionally disabled.</p>}
              {letter.status === 'draft' && !letter.canonical && <p className="w-full text-xs text-destructive">Legacy HTML drafts cannot be scheduled. Open the draft and save it through Email Studio first.</p>}
            </div>}

            {traceNewsletterId === letter.id && <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              {trace.isLoading && <p className="text-sm text-muted-foreground">Loading delivery trace…</p>}
              {trace.isError && <p className="text-sm text-destructive">{trace.error instanceof Error ? trace.error.message : 'Delivery trace unavailable.'}</p>}
              {(trace.data?.summary ?? []).length > 0 && <div className="flex flex-wrap gap-2">{(trace.data?.summary ?? []).map((row) => <Badge key={row.status} variant="outline">{row.status}: {row.count}</Badge>)}</div>}
              {(trace.data?.recipients ?? []).length === 0 && !trace.isLoading && !trace.isError && <p className="text-sm text-muted-foreground">No immutable recipient snapshot exists for this newsletter.</p>}
              {(trace.data?.recipients ?? []).map((row) => <div className="flex flex-wrap items-center gap-2 border-b py-1 text-xs last:border-0" key={row.recipientId}>
                <span className="font-medium">{row.deliveryEmail}</span>
                <Badge variant="outline">{row.recipientStatus}</Badge>
                {row.ledgerStatus && <Badge variant="secondary">ledger: {row.ledgerStatus}</Badge>}
                <span className="text-muted-foreground">{row.qualifyingAudiences.join(', ')}</span>
                {row.errorCode && <span className="text-destructive">{row.errorCode}</span>}
              </div>)}
            </div>}
          </div>;
        })}

        {schedule.isError && <p className="text-sm text-destructive">{schedule.error instanceof Error ? schedule.error.message : 'Could not schedule this newsletter.'}</p>}
        {cancelSend.isError && <p className="text-sm text-destructive">{cancelSend.error instanceof Error ? cancelSend.error.message : 'Could not cancel this send.'}</p>}
        {revise.isError && <p className="text-sm text-destructive">{revise.error instanceof Error ? revise.error.message : 'Could not create a revised draft.'}</p>}
      </CardContent>
    </Card>

    {canMutate && <Card>
      <CardHeader>
        <CardTitle>Marketing newsletter suppression</CardTitle>
        <CardDescription>Manage newsletter-only mailbox suppression. These actions never suppress transactional or operational communications.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">Suppress mailbox</p>
          <Input onChange={(event) => setSuppressEmail(event.target.value)} placeholder="person@example.com" value={suppressEmail} />
          <Input onChange={(event) => setSuppressReason(event.target.value)} placeholder="Reason" value={suppressReason} />
          <Button disabled={!suppressEmail.trim() || !suppressReason.trim() || suppress.isPending} onClick={() => suppress.mutate()} size="sm">Suppress from newsletters</Button>
          {suppress.isError && <p className="text-sm text-destructive">{suppress.error instanceof Error ? suppress.error.message : 'Could not suppress mailbox.'}</p>}
        </div>
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">Restore newsletter eligibility</p>
          <Input onChange={(event) => setRestoreEmail(event.target.value)} placeholder="person@example.com" value={restoreEmail} />
          <Input onChange={(event) => setRestoreReason(event.target.value)} placeholder="Documented resubscription reason" value={restoreReason} />
          <Button disabled={!restoreEmail.trim() || !restoreReason.trim() || unsuppress.isPending} onClick={() => unsuppress.mutate()} size="sm" variant="outline">Restore eligibility</Button>
          {unsuppress.isError && <p className="text-sm text-destructive">{unsuppress.error instanceof Error ? unsuppress.error.message : 'Could not restore mailbox.'}</p>}
        </div>
      </CardContent>
    </Card>}

    <Dialog onOpenChange={(open) => { if (!open) setComposer(null); }} open={Boolean(composer)}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{composer?.newsletterId ? 'Edit newsletter draft' : 'New newsletter'}</DialogTitle>
          <DialogDescription>
            Universal newsletters use a mailbox-safe Email Studio scope. Person-specific client, relationship, staff, and clinical variables are not available.
          </DialogDescription>
        </DialogHeader>

        {composer && <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="newsletter-name">Internal name</Label><Input id="newsletter-name" onChange={(event) => setComposer({ ...composer, name: event.target.value })} value={composer.name} /></div>
            <div className="space-y-1"><Label htmlFor="newsletter-subject">Subject line</Label><Input id="newsletter-subject" onChange={(event) => setComposer({ ...composer, subject: event.target.value })} value={composer.subject} /></div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-sm font-medium">Start from a reusable template</p><p className="text-xs text-muted-foreground">Optional. Published marketing-newsletter templates copy their immutable canonical content into this draft.</p></div>
              <Button asChild size="sm" variant="ghost"><Link to="/crm/email-studio">Open template library</Link></Button>
            </div>
            <Select value={composer.templateId ?? 'scratch'} onValueChange={(value) => {
              if (value === 'scratch') {
                setComposer({ ...composer, templateId: null, templateVersionId: null, initialContent: null });
              } else {
                loadTemplate.mutate(value);
              }
            }}>
              <SelectTrigger><SelectValue placeholder="Start from scratch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="scratch">Start from scratch</SelectItem>
                {(templates.data ?? []).map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {loadTemplate.isError && <p className="text-sm text-destructive">{loadTemplate.error instanceof Error ? loadTemplate.error.message : 'Template could not be loaded.'}</p>}
          </div>

          <div className="space-y-2">
            <Label>Audience</Label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {NEWSLETTER_AUDIENCE_DOMAINS.map((domain) => {
                const checked = composer.audienceDomains.includes(domain);
                return <label className="flex items-center gap-2 rounded border p-3 text-sm" key={domain}>
                  <Checkbox checked={checked} onCheckedChange={(value) => {
                    const next = value
                      ? [...new Set([...composer.audienceDomains, domain])]
                      : composer.audienceDomains.filter((entry) => entry !== domain);
                    setComposer({ ...composer, audienceDomains: next });
                  }} />
                  {NEWSLETTER_AUDIENCE_LABELS[domain]}
                </label>;
              })}
            </div>
            {audiencePreview.data && <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{audiencePreview.data.uniqueMailboxes} unique mailboxes</Badge>
              <Badge variant="outline">{audiencePreview.data.deliverableMailboxes} currently deliverable</Badge>
              <Badge variant="secondary">{audiencePreview.data.suppressedMailboxes} suppressed</Badge>
              <Badge variant="outline">{audiencePreview.data.overlapMailboxes} cross-audience overlaps</Badge>
            </div>}
            {audiencePreview.isError && <p className="text-sm text-destructive">{audiencePreview.error instanceof Error ? audiencePreview.error.message : 'Audience preview failed.'}</p>}
          </div>

          <MarketingNewsletterEmailStudioComposer
            key={`${composer.newsletterId ?? 'new'}-${composer.templateVersionId ?? 'scratch'}-${composer.initialContent?.renderHash ?? 'empty'}`}
            ref={editorRef}
            initialContent={composer.initialContent}
          />

          <div className="space-y-1">
            <Label htmlFor="newsletter-reason">Reason / change summary</Label>
            <Input id="newsletter-reason" onChange={(event) => setComposer({ ...composer, reason: event.target.value })} placeholder="Why this draft is being created or changed" value={composer.reason} />
          </div>

          {save.isError && <p className="text-sm text-destructive">{save.error instanceof Error ? save.error.message : 'Newsletter draft could not be saved.'}</p>}
          {saveTemplate.isError && <p className="text-sm text-destructive">{saveTemplate.error instanceof Error ? saveTemplate.error.message : 'Reusable template could not be published.'}</p>}
          {saveTemplate.isSuccess && <p className="text-sm text-muted-foreground">Reusable marketing newsletter template published to Email Studio.</p>}
        </div>}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => setComposer(null)}>Cancel</Button>
          <div className="flex flex-wrap gap-2">
            {composer && <Button
              variant="outline"
              disabled={!composer.name.trim() || !composer.subject.trim() || !composer.reason.trim() || saveTemplate.isPending}
              onClick={() => saveTemplate.mutate(composer)}
            ><FileText className="mr-2 h-4 w-4" />Publish as reusable template</Button>}
            {composer && <Button
              disabled={!composer.name.trim() || !composer.subject.trim() || !composer.reason.trim() || composer.audienceDomains.length === 0 || save.isPending}
              onClick={() => save.mutate(composer)}
            >Save canonical draft</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function RuntimeCard({ runtime, loading, error }: { runtime?: NewsletterRuntime; loading: boolean; error: unknown }) {
  if (loading) return <Card><CardHeader><CardTitle>Newsletter runtime</CardTitle><CardDescription>Loading runtime state…</CardDescription></CardHeader></Card>;
  if (!runtime || error) return <Card className="border-destructive/40"><CardHeader><CardTitle>Newsletter runtime unavailable</CardTitle><CardDescription>{error instanceof Error ? error.message : 'Runtime status could not be read.'}</CardDescription></CardHeader></Card>;

  const stateIcon = runtime.state === 'ACTIVE'
    ? <PlayCircle className="h-5 w-5" />
    : runtime.state === 'PAUSED'
      ? <PauseCircle className="h-5 w-5" />
      : <ShieldCheck className="h-5 w-5" />;
  const checks = runtime.readiness.checks;
  const checkRows: Array<[string, boolean]> = [
    ['Resend sender configured', checks.senderConfigured],
    ['Worker release marked', checks.workerReleaseMarked],
    ['Scheduler present', checks.schedulerPresent],
    ['Worker RPC least privilege', checks.workerRpcLeastPrivilege],
    ['Communications control plane enabled', checks.communicationsControlPlaneEnabled],
    ['Suppression invariant', checks.suppressionInvariant],
  ];

  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><CardTitle className="flex items-center gap-2">{stateIcon} Newsletter runtime: {runtime.state}</CardTitle><CardDescription>{runtime.reason}</CardDescription></div>
        <Badge variant={runtime.state === 'ACTIVE' ? 'default' : 'secondary'}>{runtime.readiness.canActivate ? 'activation-ready' : runtime.state.toLowerCase()}</Badge>
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      {runtime.state === 'PRELAUNCH' && <div className="flex gap-2 rounded-md border bg-muted/30 p-3 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>Authoring, templates, audience preview, and suppression management are available. The production send worker is physically disarmed and no newsletter scheduler is installed.</span></div>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {checkRows.map(([label, ok]) => <div className="flex items-center gap-2 rounded border p-2 text-xs" key={label}>
          {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{label}
        </div>)}
        <div className="flex items-center gap-2 rounded border p-2 text-xs"><Badge variant="outline">{checks.inFlightRecipients}</Badge> in-flight recipients</div>
      </div>
    </CardContent>
  </Card>;
}
