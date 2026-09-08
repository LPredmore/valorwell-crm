import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ClientNewsletterEmailStudioComposer,
  type ClientNewsletterEmailStudioHandle,
} from '@/features/email-studio/newsletter/ClientNewsletterEmailStudioComposer';
import { NewsletterEditorWorkspace } from '@/features/email-studio/newsletter/NewsletterEditorWorkspace';
import type { EmailContentDocument } from '@/features/email-studio/contracts';
import { useCanMutate } from '@/hooks/crm/useCanMutate';
import {
  NEWSLETTER_AUDIENCE_DOMAINS,
  NEWSLETTER_AUDIENCE_LABELS,
  cancelNewsletterSend,
  cloneNewsletterToDraft,
  getNewsletter,
  getNewsletterDeliveryTrace,
  listNewsletters,
  newsletterDetailToContent,
  previewNewsletterAudience,
  scheduleNewsletter,
  suppressNewsletterMailbox,
  upsertCanonicalNewsletter,
  type NewsletterAudienceDomain,
  type NewsletterSummary,
} from '@/lib/crm/newsletter-control-plane';

type ComposerState = {
  newsletterId: string | null;
  name: string;
  subject: string;
  audienceDomains: NewsletterAudienceDomain[];
  reason: string;
  initialContent: EmailContentDocument | null;
  templateVersionId: string | null;
};

type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const AUTOSAVE_REASON = 'Newsletter visual editor autosave';
const AUTOSAVE_DELAY_MS = 1200;

const emptyComposer: ComposerState = {
  newsletterId: null,
  name: '',
  subject: '',
  audienceDomains: ['client'],
  reason: '',
  initialContent: null,
  templateVersionId: null,
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
  const emailStudioRef = useRef<ClientNewsletterEmailStudioHandle>(null);
  const composerRef = useRef<ComposerState | null>(null);
  const autosaveBusyRef = useRef(false);
  const autosavePendingRef = useRef(false);
  const autosaveRevisionRef = useRef(0);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [autosaveRevision, setAutosaveRevision] = useState(0);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
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
    queryFn: () => previewNewsletterAudience(
      (audienceKey ? audienceKey.split(',') : []) as NewsletterAudienceDomain[],
    ),
    enabled: Boolean(composer) && audienceKey.length > 0,
    retry: false,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['newsletters'] });
    void queryClient.invalidateQueries({ queryKey: ['newsletter-trace'] });
  }, [queryClient]);

  const requestAutosave = () => {
    setAutosaveError(null);
    setAutosaveStatus('pending');
    setAutosaveRevision((current) => {
      const next = current + 1;
      autosaveRevisionRef.current = next;
      return next;
    });
  };

  const updateComposer = (updater: (current: ComposerState) => ComposerState) => {
    setComposer((current) => {
      if (!current) return current;
      const next = updater(current);
      composerRef.current = next;
      return next;
    });
    requestAutosave();
  };

  const closeComposer = () => {
    composerRef.current = null;
    setComposer(null);
  };

  const save = useMutation({
    mutationFn: async (state: ComposerState) => {
      const content = await emailStudioRef.current?.exportContent();
      if (!content) {
        throw new Error('Resolve the Email Studio validation errors before saving this draft.');
      }
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
      closeComposer();
      refresh();
    },
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
    mutationFn: (newsletterId: string) => cancelNewsletterSend({
      newsletterId,
      reason: reasons[newsletterId] ?? '',
    }),
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
    mutationFn: async (newsletterId: string) => {
      const detail = await getNewsletter(newsletterId);
      const content = newsletterDetailToContent(detail);
      if (detail.status !== 'draft') {
        throw new Error('Only draft newsletters can be edited. Duplicate this newsletter to create a new draft.');
      }
      if (!content) {
        throw new Error('This newsletter does not contain canonical Email Studio content and cannot be edited here.');
      }
      return { detail, content };
    },
    onSuccess: ({ detail, content }) => {
      const next: ComposerState = {
        newsletterId: detail.id,
        name: detail.name,
        subject: detail.subject ?? '',
        audienceDomains: detail.audienceDomains.length > 0 ? detail.audienceDomains : ['client'],
        reason: '',
        initialContent: content,
        templateVersionId: detail.templateVersionId,
      };
      composerRef.current = next;
      setComposer(next);
      setAutosaveStatus('idle');
      setAutosaveError(null);
    },
  });

  const duplicate = useMutation({
    mutationFn: async (letter: NewsletterSummary) => {
      const result = await cloneNewsletterToDraft({
        newsletterId: letter.id,
        name: `${letter.name} copy`,
        reason: reasons[letter.id] ?? '',
      });
      const detail = await getNewsletter(result.newsletterId);
      const content = newsletterDetailToContent(detail);
      if (!content) {
        throw new Error('The duplicated newsletter did not preserve canonical Email Studio content.');
      }
      return { detail, content };
    },
    onSuccess: ({ detail, content }) => {
      refresh();
      const next: ComposerState = {
        newsletterId: detail.id,
        name: detail.name,
        subject: detail.subject ?? '',
        audienceDomains: detail.audienceDomains.length > 0 ? detail.audienceDomains : ['client'],
        reason: '',
        initialContent: content,
        templateVersionId: detail.templateVersionId,
      };
      composerRef.current = next;
      setComposer(next);
      setAutosaveStatus('idle');
      setAutosaveError(null);
    },
  });

  const rows: NewsletterSummary[] = useMemo(() => newsletters.data?.newsletters ?? [], [newsletters.data]);

  useEffect(() => {
    composerRef.current = composer;
    if (!composer) {
      save.reset();
      setAutosaveStatus('idle');
      setAutosaveError(null);
    }
  }, [composer, save]);

  useEffect(() => {
    if (!composer || autosaveRevision === 0) return;
    const eligible = Boolean(
      composer.name.trim()
        && composer.subject.trim()
        && composer.audienceDomains.length > 0,
    );
    if (!eligible) return;

    const timeout = window.setTimeout(() => {
      const runAutosave = async () => {
        if (autosaveBusyRef.current) {
          autosavePendingRef.current = true;
          return;
        }

        autosaveBusyRef.current = true;
        setAutosaveStatus('saving');
        setAutosaveError(null);
        const revisionAtStart = autosaveRevisionRef.current;

        try {
          const content = await emailStudioRef.current?.exportContent();
          if (!content) {
            throw new Error('Autosave paused until the newsletter passes Email Studio validation.');
          }
          const current = composerRef.current;
          if (!current) return;
          if (!current.name.trim() || !current.subject.trim() || current.audienceDomains.length === 0) return;

          const result = await upsertCanonicalNewsletter({
            newsletterId: current.newsletterId,
            name: current.name.trim(),
            subject: current.subject.trim(),
            content,
            audienceDomains: current.audienceDomains,
            reason: AUTOSAVE_REASON,
            templateVersionId: current.templateVersionId,
          });

          if (composerRef.current && !composerRef.current.newsletterId) {
            const next = { ...composerRef.current, newsletterId: result.newsletterId };
            composerRef.current = next;
            setComposer(next);
          }
          refresh();
          setAutosaveStatus('saved');
        } catch (caught) {
          setAutosaveStatus('error');
          setAutosaveError(caught instanceof Error ? caught.message : 'Newsletter autosave failed.');
        } finally {
          autosaveBusyRef.current = false;
          if (autosavePendingRef.current || autosaveRevisionRef.current > revisionAtStart) {
            autosavePendingRef.current = false;
            setAutosaveRevision((current) => {
              const next = current + 1;
              autosaveRevisionRef.current = next;
              return next;
            });
          }
        }
      };
      void runAutosave();
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [autosaveRevision, composer, refresh]);

  const composerValid = Boolean(
    composer
      && composer.name.trim()
      && composer.subject.trim()
      && composer.reason.trim()
      && composer.audienceDomains.length > 0,
  );

  if (composer) {
    const audienceControls = (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-medium">Audience</span>
        {NEWSLETTER_AUDIENCE_DOMAINS.map((domain) => {
          const checked = composer.audienceDomains.includes(domain);
          return (
            <label className="flex items-center gap-2" key={domain}>
              <Checkbox
                checked={checked}
                onCheckedChange={(next) => updateComposer((current) => ({
                  ...current,
                  audienceDomains: next
                    ? [...current.audienceDomains, domain]
                    : current.audienceDomains.filter((item) => item !== domain),
                }))}
              />
              {NEWSLETTER_AUDIENCE_LABELS[domain]}
            </label>
          );
        })}
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          {audiencePreview.isLoading ? <span className="text-muted-foreground">Counting mailboxes…</span> : null}
          {audiencePreview.isError ? (
            <span className="text-destructive">
              {audiencePreview.error instanceof Error ? audiencePreview.error.message : 'Audience preview unavailable.'}
            </span>
          ) : null}
          {audiencePreview.data ? (
            <>
              <Badge variant="outline">{audiencePreview.data.deliverableMailboxes} deliverable</Badge>
              <Badge variant="secondary">{audiencePreview.data.suppressedMailboxes} unsubscribed</Badge>
              <Badge variant="outline">{audiencePreview.data.uniqueMailboxes} unique</Badge>
            </>
          ) : null}
        </div>
      </div>
    );

    return (
      <NewsletterEditorWorkspace
        title={composer.newsletterId ? 'Edit newsletter draft' : 'New newsletter'}
        name={composer.name}
        subject={composer.subject}
        reason={composer.reason}
        autosaveStatus={autosaveStatus}
        autosaveError={autosaveError}
        savePending={save.isPending}
        saveDisabled={!composerValid || autosaveStatus === 'saving'}
        onNameChange={(value) => updateComposer((current) => ({ ...current, name: value }))}
        onSubjectChange={(value) => updateComposer((current) => ({ ...current, subject: value }))}
        onReasonChange={(value) => setComposer((current) => current ? { ...current, reason: value } : current)}
        onClose={closeComposer}
        onPreview={() => { void emailStudioRef.current?.preview(); }}
        onSave={() => save.mutate(composer)}
        audienceControls={audienceControls}
      >
        <div className="relative h-full min-h-0">
          {save.isError ? (
            <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-md border border-destructive/30 bg-background px-4 py-2 text-sm text-destructive shadow-lg">
              {save.error instanceof Error ? save.error.message : 'Could not save this newsletter.'}
            </div>
          ) : null}
          <ClientNewsletterEmailStudioComposer
            ref={emailStudioRef}
            initialContent={composer.initialContent}
            scope="marketing_newsletter"
            onDirty={requestAutosave}
          />
        </div>
      </NewsletterEditorWorkspace>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Newsletters</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Design canonical Email Studio newsletters, verify the eligible mailbox count, then send now or schedule delivery. Recipient snapshots and suppression checks are enforced by the server when a draft is scheduled.
          </p>
        </div>
        <Button disabled={!canMutate} onClick={() => {
          const next = { ...emptyComposer };
          composerRef.current = next;
          setComposer(next);
          setAutosaveStatus('idle');
          setAutosaveError(null);
        }}>
          New newsletter
        </Button>
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
          {newsletters.isError && (
            <p className="text-sm text-destructive">
              {newsletters.error instanceof Error ? newsletters.error.message : 'Newsletters unavailable.'}
            </p>
          )}
          {rows.length === 0 && !newsletters.isLoading && !newsletters.isError && (
            <p className="text-sm text-muted-foreground">No newsletters yet. Create one to get started.</p>
          )}

          {rows.map((letter) => {
            const reason = reasons[letter.id] ?? '';
            const editable = letter.status === 'draft' && letter.canonical;
            return (
              <div className="space-y-3 rounded-md border p-3" key={letter.id}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{letter.name}</span>
                  <Badge variant={statusVariant(letter.status)}>{letter.status}</Badge>
                  {letter.canonical && <Badge variant="secondary">Email Studio</Badge>}
                  {letter.audienceDomains.map((domain) => (
                    <Badge key={domain} variant="outline">{NEWSLETTER_AUDIENCE_LABELS[domain] ?? domain}</Badge>
                  ))}
                  {letter.scheduledAt && (
                    <span className="text-muted-foreground">scheduled {new Date(letter.scheduledAt).toLocaleString()}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{letter.queued} queued</Badge>
                  {letter.processing > 0 && <Badge variant="outline">{letter.processing} sending</Badge>}
                  <Badge variant="outline">{letter.sent} sent</Badge>
                  {letter.failed > 0 && <Badge variant="destructive">{letter.failed} failed</Badge>}
                  <Badge variant="secondary">{letter.suppressed} unsubscribed</Badge>
                  {letter.skipped > 0 && <Badge variant="outline">{letter.skipped} skipped</Badge>}
                </div>
                {letter.subject && <p className="text-sm text-muted-foreground">Subject: {letter.subject}</p>}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => setTraceNewsletterId((current) => (current === letter.id ? null : letter.id))}
                    size="sm"
                    variant="ghost"
                  >
                    {traceNewsletterId === letter.id ? 'Hide delivery trace' : 'Delivery trace'}
                  </Button>
                  {canMutate && editable && (
                    <Button disabled={openExisting.isPending} onClick={() => openExisting.mutate(letter.id)} size="sm" variant="outline">
                      Edit draft
                    </Button>
                  )}
                </div>

                {canMutate && letter.canonical && (
                  <div className="flex flex-wrap items-end gap-2 rounded border bg-muted/30 p-3">
                    <div className="min-w-56 flex-1 space-y-1">
                      <Label htmlFor={`reason-${letter.id}`}>Reason for this action</Label>
                      <Input
                        id={`reason-${letter.id}`}
                        onChange={(event) => setReasons((current) => ({ ...current, [letter.id]: event.target.value }))}
                        placeholder="Why this send is changing"
                        value={reason}
                      />
                    </div>
                    {letter.status === 'draft' && (
                      <div className="space-y-1">
                        <Label htmlFor={`when-${letter.id}`}>Send at (optional)</Label>
                        <Input
                          id={`when-${letter.id}`}
                          onChange={(event) => setScheduleAt((current) => ({ ...current, [letter.id]: event.target.value }))}
                          type="datetime-local"
                          value={scheduleAt[letter.id] ?? ''}
                        />
                      </div>
                    )}
                    <Button
                      disabled={!reason.trim() || duplicate.isPending}
                      onClick={() => duplicate.mutate(letter)}
                      size="sm"
                      variant="outline"
                    >
                      Duplicate to draft
                    </Button>
                    {letter.status === 'draft' && (
                      <Button disabled={!reason.trim() || schedule.isPending} onClick={() => schedule.mutate(letter.id)} size="sm">
                        {scheduleAt[letter.id] ? 'Schedule send' : 'Send now'}
                      </Button>
                    )}
                    {letter.status === 'scheduled' && (
                      <Button
                        disabled={!reason.trim() || cancelSend.isPending}
                        onClick={() => cancelSend.mutate(letter.id)}
                        size="sm"
                        variant="destructive"
                      >
                        Cancel send
                      </Button>
                    )}
                  </div>
                )}

                {traceNewsletterId === letter.id && (
                  <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                    {trace.isLoading && <p className="text-sm text-muted-foreground">Loading delivery trace…</p>}
                    {trace.isError && (
                      <p className="text-sm text-destructive">
                        {trace.error instanceof Error ? trace.error.message : 'Delivery trace unavailable.'}
                      </p>
                    )}
                    {(trace.data?.summary ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {(trace.data?.summary ?? []).map((row) => (
                          <Badge key={row.status} variant="outline">{row.status}: {row.count}</Badge>
                        ))}
                      </div>
                    )}
                    {(trace.data?.recipients ?? []).length === 0 && !trace.isLoading && !trace.isError && (
                      <p className="text-sm text-muted-foreground">No recipient snapshot yet.</p>
                    )}
                    {(trace.data?.recipients ?? []).map((row) => (
                      <div className="flex flex-wrap items-center gap-2 border-b py-1 text-xs last:border-0" key={row.recipientId}>
                        <span className="font-medium">{row.deliveryEmail}</span>
                        <Badge variant="outline">{row.recipientStatus}</Badge>
                        {row.ledgerStatus && <Badge variant="secondary">ledger: {row.ledgerStatus}</Badge>}
                        <span className="text-muted-foreground">{row.qualifyingAudiences.join(', ')}</span>
                        {row.errorCode && <span className="text-destructive">{row.errorCode}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {schedule.isError && (
            <p className="text-sm text-destructive">
              {schedule.error instanceof Error ? schedule.error.message : 'Could not schedule this newsletter.'}
            </p>
          )}
          {cancelSend.isError && (
            <p className="text-sm text-destructive">
              {cancelSend.error instanceof Error ? cancelSend.error.message : 'Could not cancel this send.'}
            </p>
          )}
          {openExisting.isError && (
            <p className="text-sm text-destructive">
              {openExisting.error instanceof Error ? openExisting.error.message : 'Could not open this newsletter.'}
            </p>
          )}
          {duplicate.isError && (
            <p className="text-sm text-destructive">
              {duplicate.error instanceof Error ? duplicate.error.message : 'Could not duplicate this newsletter.'}
            </p>
          )}
        </CardContent>
      </Card>

      {canMutate && (
        <Card>
          <CardHeader>
            <CardTitle>Unsubscribe list</CardTitle>
            <CardDescription>Add a mailbox by hand when someone asks to be removed outside of the unsubscribe link.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="suppress-email">Email address</Label>
              <Input
                className="max-w-xs"
                id="suppress-email"
                onChange={(event) => setSuppressEmail(event.target.value)}
                placeholder="person@example.com"
                value={suppressEmail}
              />
            </div>
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="suppress-reason">Reason</Label>
              <Input
                id="suppress-reason"
                onChange={(event) => setSuppressReason(event.target.value)}
                placeholder="Requested by phone"
                value={suppressReason}
              />
            </div>
            <Button
              disabled={!suppressEmail.trim() || !suppressReason.trim() || suppress.isPending}
              onClick={() => suppress.mutate()}
              size="sm"
            >
              Unsubscribe mailbox
            </Button>
            {suppress.isError && (
              <p className="w-full text-sm text-destructive">
                {suppress.error instanceof Error ? suppress.error.message : 'Could not update the unsubscribe list.'}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
