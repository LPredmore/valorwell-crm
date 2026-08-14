import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  NEWSLETTER_AUDIENCE_DOMAINS,
  NEWSLETTER_AUDIENCE_LABELS,
  buildNewsletterRecipients,
  cancelNewsletterSend,
  getNewsletter,
  getNewsletterDeliveryTrace,
  listNewsletters,
  previewNewsletterAudience,
  scheduleNewsletter,
  suppressNewsletterMailbox,
  upsertNewsletter,
  type NewsletterSummary,
} from '@/lib/crm/communications-control-plane';

type ComposerState = {
  newsletterId: string | null;
  name: string;
  subject: string;
  preheader: string;
  bodyHtml: string;
  bodyText: string;
  audienceDomains: string[];
  reason: string;
};

const emptyComposer: ComposerState = {
  newsletterId: null,
  name: '',
  subject: '',
  preheader: '',
  bodyHtml: '',
  bodyText: '',
  audienceDomains: ['client'],
  reason: '',
};

function statusVariant(status: string) {
  if (status === 'sending') return 'default' as const;
  if (status === 'completed') return 'secondary' as const;
  if (status === 'cancelled') return 'destructive' as const;
  return 'outline' as const;
}

export default function NewsletterManagementPage() {
  const canMutate = useCanMutate();
  const queryClient = useQueryClient();
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [scheduleAt, setScheduleAt] = useState<Record<string, string>>({});
  const [traceNewsletterId, setTraceNewsletterId] = useState<string | null>(null);
  const [suppressEmail, setSuppressEmail] = useState('');
  const [suppressReason, setSuppressReason] = useState('');

  const newsletters = useQuery({ queryKey: ['newsletters'], queryFn: listNewsletters, retry: false });
  const trace = useQuery({
    queryKey: ['newsletter-trace', traceNewsletterId],
    queryFn: () => getNewsletterDeliveryTrace(traceNewsletterId as string),
    enabled: Boolean(traceNewsletterId),
    retry: false,
  });

  const audienceKey = composer?.audienceDomains.slice().sort().join(',') ?? '';
  const audiencePreview = useQuery({
    queryKey: ['newsletter-audience-preview', audienceKey],
    queryFn: () => previewNewsletterAudience(audienceKey ? audienceKey.split(',') : []),
    enabled: Boolean(composer) && audienceKey.length > 0,
    retry: false,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['newsletters'] });
    void queryClient.invalidateQueries({ queryKey: ['newsletter-trace'] });
  };

  const save = useMutation({
    mutationFn: (state: ComposerState) =>
      upsertNewsletter({
        newsletterId: state.newsletterId,
        name: state.name.trim(),
        subject: state.subject.trim() || null,
        preheader: state.preheader.trim() || null,
        bodyHtml: state.bodyHtml || null,
        bodyText: state.bodyText || null,
        audienceDomains: state.audienceDomains,
        reason: state.reason.trim(),
      }),
    onSuccess: () => {
      setComposer(null);
      refresh();
    },
  });

  const build = useMutation({
    mutationFn: (newsletterId: string) =>
      buildNewsletterRecipients({ newsletterId, reason: reasons[newsletterId] ?? '' }),
    onSuccess: refresh,
  });

  const schedule = useMutation({
    mutationFn: (newsletterId: string) =>
      scheduleNewsletter({
        newsletterId,
        scheduledAt: scheduleAt[newsletterId] ? new Date(scheduleAt[newsletterId]).toISOString() : null,
        reason: reasons[newsletterId] ?? '',
      }),
    onSuccess: refresh,
  });

  const cancelSend = useMutation({
    mutationFn: (newsletterId: string) => cancelNewsletterSend({ newsletterId, reason: reasons[newsletterId] ?? '' }),
    onSuccess: refresh,
  });

  const suppress = useMutation({
    mutationFn: () => suppressNewsletterMailbox({ email: suppressEmail.trim(), reason: suppressReason.trim() }),
    onSuccess: () => {
      setSuppressEmail('');
      setSuppressReason('');
      refresh();
    },
  });

  const openExisting = useMutation({
    mutationFn: (newsletterId: string) => getNewsletter(newsletterId),
    onSuccess: (detail) => {
      setComposer({
        newsletterId: detail.id,
        name: detail.name,
        subject: detail.subject ?? '',
        preheader: detail.preheader ?? '',
        bodyHtml: detail.bodyHtml ?? '',
        bodyText: detail.bodyText ?? '',
        audienceDomains: detail.audienceDomains.length > 0 ? detail.audienceDomains : ['client'],
        reason: '',
      });
    },
  });

  const rows: NewsletterSummary[] = useMemo(() => newsletters.data?.newsletters ?? [], [newsletters.data]);

  useEffect(() => {
    if (!composer) save.reset();
  }, [composer, save]);

  const composerValid = Boolean(
    composer && composer.name.trim() && composer.reason.trim() && composer.audienceDomains.length > 0,
  );

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Newsletters</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Compose a newsletter, preview which mailboxes it will reach across every audience, then build the recipient list and schedule the send. Sending stays blocked until the universal newsletters switch is on.
        </p>
      </div>
      <Button disabled={!canMutate} onClick={() => setComposer({ ...emptyComposer })}>New newsletter</Button>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>All newsletters</CardTitle>
        <CardDescription>
          {newsletters.data?.suppressedMailboxes ?? 0} mailboxes have unsubscribed. An unsubscribe covers the whole mailbox, so shared family addresses share one decision.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {newsletters.isLoading && <p className="text-sm text-muted-foreground">Loading newsletters…</p>}
        {newsletters.isError && <p className="text-sm text-destructive">{newsletters.error instanceof Error ? newsletters.error.message : 'Newsletters unavailable.'}</p>}
        {rows.length === 0 && !newsletters.isLoading && !newsletters.isError && <p className="text-sm text-muted-foreground">No newsletters yet. Create one to get started.</p>}

        {rows.map((letter) => {
          const reason = reasons[letter.id] ?? '';
          const editable = letter.status === 'draft' || letter.status === 'scheduled';
          return <div className="space-y-3 rounded-md border p-3" key={letter.id}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{letter.name}</span>
              <Badge variant={statusVariant(letter.status)}>{letter.status}</Badge>
              {letter.audienceDomains.map((domain) => <Badge key={domain} variant="outline">{NEWSLETTER_AUDIENCE_LABELS[domain] ?? domain}</Badge>)}
              {letter.scheduledAt && <span className="text-muted-foreground">scheduled {new Date(letter.scheduledAt).toLocaleString()}</span>}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{letter.queued} queued</Badge>
              {letter.processing > 0 && <Badge variant="outline">{letter.processing} sending</Badge>}
              <Badge variant="outline">{letter.sent} sent</Badge>
              {letter.failed > 0 && <Badge variant="destructive">{letter.failed} failed</Badge>}
              <Badge variant="secondary">{letter.suppressed} unsubscribed</Badge>
            </div>
            {letter.subject && <p className="text-sm text-muted-foreground">Subject: {letter.subject}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setTraceNewsletterId((current) => (current === letter.id ? null : letter.id))} size="sm" variant="ghost">
                {traceNewsletterId === letter.id ? 'Hide delivery trace' : 'Delivery trace'}
              </Button>
              {canMutate && editable && <Button disabled={openExisting.isPending} onClick={() => openExisting.mutate(letter.id)} size="sm" variant="outline">
                Edit content
              </Button>}
            </div>

            {canMutate && (editable || letter.status === 'sending') && <div className="flex flex-wrap items-end gap-2 rounded border bg-muted/30 p-3">
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor={`reason-${letter.id}`}>Reason for this action</Label>
                <Input
                  id={`reason-${letter.id}`}
                  onChange={(event) => setReasons((current) => ({ ...current, [letter.id]: event.target.value }))}
                  placeholder="Why this send is changing"
                  value={reason}
                />
              </div>
              {editable && <div className="space-y-1">
                <Label htmlFor={`when-${letter.id}`}>Send at (optional)</Label>
                <Input
                  id={`when-${letter.id}`}
                  onChange={(event) => setScheduleAt((current) => ({ ...current, [letter.id]: event.target.value }))}
                  type="datetime-local"
                  value={scheduleAt[letter.id] ?? ''}
                />
              </div>}
              {editable && <Button disabled={!reason.trim() || build.isPending} onClick={() => build.mutate(letter.id)} size="sm" variant="outline">
                Build recipients
              </Button>}
              {editable && <Button disabled={!reason.trim() || schedule.isPending} onClick={() => schedule.mutate(letter.id)} size="sm">
                {scheduleAt[letter.id] ? 'Schedule send' : 'Send now'}
              </Button>}
              {(letter.status === 'scheduled' || letter.status === 'sending') && <Button
                disabled={!reason.trim() || cancelSend.isPending}
                onClick={() => cancelSend.mutate(letter.id)}
                size="sm"
                variant="destructive"
              >
                Cancel send
              </Button>}
            </div>}

            {traceNewsletterId === letter.id && <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              {trace.isLoading && <p className="text-sm text-muted-foreground">Loading delivery trace…</p>}
              {trace.isError && <p className="text-sm text-destructive">{trace.error instanceof Error ? trace.error.message : 'Delivery trace unavailable.'}</p>}
              {(trace.data?.summary ?? []).length > 0 && <div className="flex flex-wrap gap-2">
                {(trace.data?.summary ?? []).map((row) => <Badge key={row.status} variant="outline">{row.status}: {row.count}</Badge>)}
              </div>}
              {(trace.data?.recipients ?? []).length === 0 && !trace.isLoading && !trace.isError && <p className="text-sm text-muted-foreground">No recipients have been built yet.</p>}
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

        {build.isError && <p className="text-sm text-destructive">{build.error instanceof Error ? build.error.message : 'Could not build the recipient list.'}</p>}
        {schedule.isError && <p className="text-sm text-destructive">{schedule.error instanceof Error ? schedule.error.message : 'Could not schedule this newsletter.'}</p>}
        {cancelSend.isError && <p className="text-sm text-destructive">{cancelSend.error instanceof Error ? cancelSend.error.message : 'Could not cancel this send.'}</p>}
        {openExisting.isError && <p className="text-sm text-destructive">{openExisting.error instanceof Error ? openExisting.error.message : 'Could not open this newsletter.'}</p>}
      </CardContent>
    </Card>

    {canMutate && <Card>
      <CardHeader>
        <CardTitle>Unsubscribe list</CardTitle>
        <CardDescription>Add a mailbox by hand when someone asks to be removed outside of the unsubscribe link.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="suppress-email">Email address</Label>
          <Input className="max-w-xs" id="suppress-email" onChange={(event) => setSuppressEmail(event.target.value)} placeholder="person@example.com" value={suppressEmail} />
        </div>
        <div className="min-w-56 flex-1 space-y-1">
          <Label htmlFor="suppress-reason">Reason</Label>
          <Input id="suppress-reason" onChange={(event) => setSuppressReason(event.target.value)} placeholder="Requested by phone" value={suppressReason} />
        </div>
        <Button disabled={!suppressEmail.trim() || !suppressReason.trim() || suppress.isPending} onClick={() => suppress.mutate()} size="sm">
          Unsubscribe mailbox
        </Button>
        {suppress.isError && <p className="w-full text-sm text-destructive">{suppress.error instanceof Error ? suppress.error.message : 'Could not update the unsubscribe list.'}</p>}
      </CardContent>
    </Card>}

    <Dialog onOpenChange={(open) => { if (!open) setComposer(null); }} open={Boolean(composer)}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{composer?.newsletterId ? 'Edit newsletter' : 'New newsletter'}</DialogTitle>
          <DialogDescription>
            Personalisation is limited to a greeting name, so a shared mailbox never sees another person's details.
          </DialogDescription>
        </DialogHeader>

        {composer && <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="newsletter-name">Internal name</Label>
              <Input id="newsletter-name" onChange={(event) => setComposer({ ...composer, name: event.target.value })} value={composer.name} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="newsletter-subject">Subject line</Label>
              <Input id="newsletter-subject" onChange={(event) => setComposer({ ...composer, subject: event.target.value })} value={composer.subject} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="newsletter-preheader">Preheader</Label>
            <Input id="newsletter-preheader" onChange={(event) => setComposer({ ...composer, preheader: event.target.value })} value={composer.preheader} />
          </div>

          <div className="space-y-2">
            <Label>Audiences</Label>
            <div className="flex flex-wrap gap-3">
              {NEWSLETTER_AUDIENCE_DOMAINS.map((domain) => {
                const checked = composer.audienceDomains.includes(domain);
                return <label className="flex items-center gap-2 text-sm" key={domain}>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => setComposer({
                      ...composer,
                      audienceDomains: next
                        ? [...composer.audienceDomains, domain]
                        : composer.audienceDomains.filter((item) => item !== domain),
                    })}
                  />
                  {NEWSLETTER_AUDIENCE_LABELS[domain]}
                </label>;
              })}
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Audience preview</p>
            {audiencePreview.isLoading && <p className="text-muted-foreground">Counting mailboxes…</p>}
            {audiencePreview.isError && <p className="text-destructive">{audiencePreview.error instanceof Error ? audiencePreview.error.message : 'Preview unavailable.'}</p>}
            {audiencePreview.data && <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{audiencePreview.data.deliverableMailboxes} deliverable</Badge>
                <Badge variant="secondary">{audiencePreview.data.suppressedMailboxes} unsubscribed</Badge>
                <Badge variant="outline">{audiencePreview.data.uniqueMailboxes} unique mailboxes</Badge>
                <Badge variant="outline">{audiencePreview.data.overlapMailboxes} in more than one audience</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {Object.entries(audiencePreview.data.byDomain).map(([domain, count]) => `${NEWSLETTER_AUDIENCE_LABELS[domain] ?? domain}: ${count}`).join(' · ') || 'No matching mailboxes.'}
              </p>
              {audiencePreview.data.sample.length > 0 && <p className="text-xs text-muted-foreground">
                Sample: {audiencePreview.data.sample.map((row) => `${row.email}${row.suppressed ? ' (unsubscribed)' : ''}`).join(', ')}
              </p>}
            </div>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="newsletter-html">HTML body</Label>
            <Textarea id="newsletter-html" onChange={(event) => setComposer({ ...composer, bodyHtml: event.target.value })} rows={10} value={composer.bodyHtml} />
            <p className="text-xs text-muted-foreground">A postal address and one-click unsubscribe link are added automatically if your HTML does not include them.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="newsletter-text">Plain text body</Label>
            <Textarea id="newsletter-text" onChange={(event) => setComposer({ ...composer, bodyText: event.target.value })} rows={5} value={composer.bodyText} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="newsletter-reason">Reason for this change</Label>
            <Input id="newsletter-reason" onChange={(event) => setComposer({ ...composer, reason: event.target.value })} value={composer.reason} />
          </div>

          {save.isError && <p className="text-sm text-destructive">{save.error instanceof Error ? save.error.message : 'Could not save this newsletter.'}</p>}
        </div>}

        <DialogFooter>
          <Button onClick={() => setComposer(null)} variant="outline">Cancel</Button>
          <Button disabled={!composerValid || save.isPending} onClick={() => composer && save.mutate(composer)}>
            {save.isPending ? 'Saving…' : 'Save newsletter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
