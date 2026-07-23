import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Send } from 'lucide-react';
import { dataProvider } from '@/services/dataProvider';
import type { CommunicationPolicyResult } from '@/domain/operations';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { SuppressionBanner } from './SuppressionBanner';
import { useCanMutate } from '@/hooks/crm/useCanMutate';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { ClientPicker, type PickedClient } from './ClientPicker';
import {
  DirectEmailStudioComposer,
  type DirectEmailStudioHandle,
} from '@/features/email-studio/direct';
import {
  listPublishedDirectEmailTemplates,
  type PublishedDirectEmailTemplate,
} from '@/features/email-studio/templates';

/** Must match the backend communication-policy vocabulary exactly. */
type MessageClass =
  | 'ordinary_promotional'
  | 'ordinary_campaign_follow_up'
  | 'wait_path_ordinary'
  | 'necessary_scheduling'
  | 'active_care'
  | 'billing_insurance'
  | 'clinical_safety_legal'
  | 'transactional_account';

const MESSAGE_CLASS_LABELS: Record<MessageClass, string> = {
  ordinary_promotional: 'Ordinary — promotional',
  ordinary_campaign_follow_up: 'Ordinary — campaign follow-up',
  wait_path_ordinary: 'Wait path — ordinary',
  necessary_scheduling: 'Necessary — scheduling',
  active_care: 'Active care',
  billing_insurance: 'Billing / insurance',
  clinical_safety_legal: 'Clinical / safety / legal',
  transactional_account: 'Transactional — account',
};

const REASON_COPY: Record<string, string> = {
  contact_policy_dnc: 'Client is on the Do Not Contact list for this channel.',
  service_policy_blocked: 'Service policy blocks this message class for the client.',
  unknown_canonical_state: 'Cannot resolve the client\'s canonical state — refresh and try again.',
  class_never_permitted: 'This message class is never permitted for this client.',
  lifecycle_closed_no_active_care: 'Client is Closed and no active-care exception applies.',
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId?: string;
  clientDisplayName?: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  defaultChannel?: 'sms' | 'email';
}

export function PolicyAwareComposer({
  open,
  onOpenChange,
  clientId,
  clientDisplayName,
  clientEmail = null,
  clientPhone = null,
  defaultChannel = 'sms',
}: Props) {
  const canMutate = useCanMutate();
  const { currentTenantId } = useCrmAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const studioRef = useRef<DirectEmailStudioHandle>(null);

  const [channel, setChannel] = useState<'sms' | 'email'>(defaultChannel);
  const [messageClass, setMessageClass] = useState<MessageClass>('necessary_scheduling');
  const [selected, setSelected] = useState<PickedClient | null>(
    clientId ? { id: clientId, displayName: clientDisplayName ?? 'Selected client', email: clientEmail, phone: clientPhone } : null,
  );
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [policy, setPolicy] = useState<CommunicationPolicyResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<PublishedDirectEmailTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [selectedTemplateVersionId, setSelectedTemplateVersionId] = useState<string | null>(null);
  const [studioTemplate, setStudioTemplate] = useState<PublishedDirectEmailTemplate | null>(null);
  const [studioKey, setStudioKey] = useState(0);

  const preselected = Boolean(clientId);
  const activeClientId = selected?.id ?? '';

  useEffect(() => {
    if (!open) return;
    setChannel(defaultChannel);
    setMessageClass('necessary_scheduling');
    setSubject('');
    setBody('');
    setPolicy(null);
    setSelectedTemplateVersionId(null);
    setStudioTemplate(null);
    setStudioKey((value) => value + 1);
    setSelected(
      clientId
        ? { id: clientId, displayName: clientDisplayName ?? 'Selected client', email: clientEmail, phone: clientPhone }
        : null,
    );
  }, [open, defaultChannel, clientId, clientDisplayName, clientEmail, clientPhone]);

  useEffect(() => {
    setPolicy(null);
  }, [channel, messageClass, activeClientId]);

  useEffect(() => {
    if (!open || !activeClientId) return;
    let cancelled = false;
    setChecking(true);
    dataProvider.communications
      .evaluatePolicy({ clientId: activeClientId, channel, messageClass })
      .then((result) => { if (!cancelled) setPolicy(result); })
      .catch(() => {
        if (!cancelled) {
          setPolicy({
            allowed: false,
            requiresReview: false,
            reasons: ['policy_check_failed'],
            suppressionCode: 'policy_check_failed',
          });
        }
      })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [open, activeClientId, channel, messageClass]);

  useEffect(() => {
    if (!open || channel !== 'email' || templatesLoading || templates.length > 0) return;
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplateError(null);
    listPublishedDirectEmailTemplates()
      .then((records) => { if (!cancelled) setTemplates(records); })
      .catch((caught) => {
        if (!cancelled) setTemplateError(caught instanceof Error ? caught.message : 'Published templates could not be loaded.');
      })
      .finally(() => { if (!cancelled) setTemplatesLoading(false); });
    return () => { cancelled = true; };
  }, [open, channel, templatesLoading, templates.length]);

  const friendlyReasons = useMemo(() => {
    if (!policy) return [] as string[];
    return policy.reasons.map((reason) => REASON_COPY[reason] ?? reason);
  }, [policy]);

  const displayPolicy = useMemo<CommunicationPolicyResult | null>(() => {
    if (!policy) return null;
    return { ...policy, reasons: friendlyReasons };
  }, [policy, friendlyReasons]);

  const blocked = policy && !policy.allowed;
  const recipientHint = useMemo(() => {
    if (!selected) return '';
    return channel === 'sms' ? (selected.phone ?? 'No phone on file') : (selected.email ?? 'No email on file');
  }, [selected, channel]);
  const missingRecipient = !!selected
    && ((channel === 'sms' && !selected.phone) || (channel === 'email' && !selected.email));

  const selectTemplate = (value: string) => {
    if (value === 'blank') {
      setSelectedTemplateVersionId(null);
      setStudioTemplate(null);
      setSubject('');
      setStudioKey((key) => key + 1);
      return;
    }
    const template = templates.find((entry) => entry.versionId === value);
    if (!template) return;
    setSelectedTemplateVersionId(template.versionId);
    setStudioTemplate(template);
    setSubject(template.subject);
    setStudioKey((key) => key + 1);
  };

  const markTemplateCustomized = () => {
    setSelectedTemplateVersionId(null);
  };

  const handleSend = async () => {
    if (!selected || !currentTenantId) return;
    if (channel === 'sms' && !body.trim()) return;
    if (channel === 'email' && !subject.trim()) return;

    setSending(true);
    try {
      const fresh = await dataProvider.communications.evaluatePolicy({
        clientId: selected.id,
        channel,
        messageClass,
      });
      setPolicy(fresh);
      if (!fresh.allowed) {
        toast({
          title: 'Send blocked by policy',
          description: fresh.reasons.map((reason) => REASON_COPY[reason] ?? reason).join('; ')
            || 'Server-side policy denied this send.',
          variant: 'destructive',
        });
        return;
      }

      const emailContent = channel === 'email'
        ? await studioRef.current?.exportContent() ?? null
        : null;
      if (channel === 'email' && !emailContent) {
        toast({
          title: 'Email content is not valid',
          description: 'Resolve the Email Studio validation errors before sending.',
          variant: 'destructive',
        });
        return;
      }

      const result = await dataProvider.communications.send({
        tenantId: currentTenantId,
        clientId: selected.id,
        channel,
        direction: 'outbound',
        from: '',
        to: '',
        subject: channel === 'email' ? subject : undefined,
        body: channel === 'email' ? emailContent?.renderedText || '' : body,
        threadId: `${channel}-${selected.id}`,
        messageClass,
        emailContent: emailContent || undefined,
        emailTemplateVersionId: channel === 'email' ? selectedTemplateVersionId : undefined,
        source: channel === 'email' ? 'manual_email_studio' : 'manual_sms',
      });
      qc.invalidateQueries({ queryKey: ['crm-comms'] });
      const suppressed = result.status === 'suppressed';
      toast({
        title: suppressed ? 'Message suppressed' : 'Message sent',
        description: suppressed
          ? (result.suppressionReason ? (REASON_COPY[result.suppressionReason] ?? result.suppressionReason) : 'Server-side policy suppressed this send.')
          : undefined,
        variant: suppressed ? 'destructive' : undefined,
      });
      if (!suppressed) onOpenChange(false);
    } catch (caught) {
      toast({
        title: 'Send failed',
        description: caught instanceof Error ? caught.message : 'The message could not be sent.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const sendDisabled =
    sending
    || checking
    || !selected
    || missingRecipient
    || !canMutate
    || !currentTenantId
    || !!blocked
    || (channel === 'sms' ? !body.trim() : !subject.trim());

  const sendLabel = !canMutate
    ? 'Read-only'
    : !selected
      ? 'Select a client'
      : missingRecipient
        ? 'No recipient on file'
        : checking
          ? 'Checking policy…'
          : blocked
            ? 'Blocked by policy'
            : sending
              ? 'Sending…'
              : 'Send';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={channel === 'email'
        ? 'max-h-[94vh] w-[96vw] max-w-[1500px] overflow-y-auto'
        : 'max-w-lg'}>
        <DialogHeader>
          <DialogTitle>New {channel === 'sms' ? 'SMS' : 'Email'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Client</Label>
            <ClientPicker
              value={selected}
              onChange={setSelected}
              disabled={preselected}
              requireChannel={channel}
            />
            {selected && (
              <p className={`text-xs ${missingRecipient ? 'text-destructive' : 'text-muted-foreground'}`}>
                Sends to: {recipientHint}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(value: 'sms' | 'email') => setChannel(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Message class</Label>
              <Select value={messageClass} onValueChange={(value: MessageClass) => setMessageClass(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MESSAGE_CLASS_LABELS) as MessageClass[]).map((key) => (
                    <SelectItem key={key} value={key}>{MESSAGE_CLASS_LABELS[key]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {channel === 'email' ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Published Direct template</Label>
                  <Select
                    value={selectedTemplateVersionId || 'blank'}
                    onValueChange={selectTemplate}
                    disabled={templatesLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={templatesLoading ? 'Loading templates…' : 'Start from a blank email'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blank">Blank Direct email</SelectItem>
                      {templates.map((template) => (
                        <SelectItem key={template.versionId} value={template.versionId}>
                          {template.name} · v{template.versionNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {templatesLoading ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Loading immutable versions…</p> : null}
                  {templateError ? <p className="text-xs text-destructive">{templateError}</p> : null}
                  {studioTemplate?.description ? <p className="text-xs text-muted-foreground">{studioTemplate.description}</p> : null}
                  {studioTemplate && !selectedTemplateVersionId ? <p className="text-xs text-amber-700">This email has been customized and will be recorded as ad-hoc content rather than attributed to the immutable version.</p> : null}
                </div>
                <div className="space-y-1.5">
                  <Label>Subject</Label>
                  <Input
                    value={subject}
                    onChange={(event) => {
                      setSubject(event.target.value);
                      markTemplateCustomized();
                    }}
                    placeholder="Subject may use approved client variables"
                  />
                </div>
              </div>

              <DirectEmailStudioComposer
                key={`${studioKey}-${studioTemplate?.versionId || 'blank'}`}
                ref={studioRef}
                initialContent={studioTemplate?.content}
                readOnly={!canMutate}
                onDirty={markTemplateCustomized}
              />
            </>
          ) : (
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
            </div>
          )}

          <SuppressionBanner policy={displayPolicy} checking={checking} />
          {blocked && (
            <p className="text-xs text-muted-foreground">
              This send is blocked by server-side policy. Operators cannot override it; resolve the underlying policy state or choose a different message class.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleSend()} disabled={sendDisabled} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sendLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
