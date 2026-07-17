import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Send } from 'lucide-react';
import { dataProvider } from '@/services/dataProvider';
import type { CommunicationPolicyResult } from '@/domain/operations';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { SuppressionBanner } from './SuppressionBanner';
import { useCanMutate } from '@/hooks/crm/useCanMutate';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { ClientPicker, type PickedClient } from './ClientPicker';

/**
 * Canonical message class vocabulary — MUST match the backend enum accepted by
 * `crm_evaluate_communication_policy` and the suppression edge helper. Never
 * translate or synthesize these client-side; the backend is authoritative.
 */
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

/**
 * Friendly copy for the backend reason codes returned by
 * `crm_evaluate_communication_policy`. Anything unknown falls back to the raw
 * reason strings so we never hide backend detail from the operator.
 */
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
  /** Preselect a client (e.g. when opened from a client detail page). */
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

  const preselected = Boolean(clientId);
  const activeClientId = selected?.id ?? '';

  useEffect(() => {
    if (!open) return;
    setChannel(defaultChannel);
    setMessageClass('necessary_scheduling');
    setSubject('');
    setBody('');
    setPolicy(null);
    setSelected(
      clientId
        ? { id: clientId, displayName: clientDisplayName ?? 'Selected client', email: clientEmail, phone: clientPhone }
        : null,
    );
  }, [open, defaultChannel, clientId, clientDisplayName, clientEmail, clientPhone]);

  // Policy is re-evaluated whenever any input to the decision changes.
  useEffect(() => {
    setPolicy(null);
  }, [channel, messageClass, activeClientId]);

  useEffect(() => {
    if (!open || !activeClientId) return;
    let cancelled = false;
    setChecking(true);
    dataProvider.communications
      .evaluatePolicy({ clientId: activeClientId, channel, messageClass })
      .then((r) => { if (!cancelled) setPolicy(r); })
      .catch(() => { if (!cancelled) setPolicy({ allowed: false, reasons: ['policy_check_failed'], suppressionCode: 'policy_check_failed' } as CommunicationPolicyResult); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [open, activeClientId, channel, messageClass]);

  const friendlyReasons = useMemo(() => {
    if (!policy) return [] as string[];
    return policy.reasons.map((r) => REASON_COPY[r] ?? r);
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

  const missingRecipient =
    !!selected && ((channel === 'sms' && !selected.phone) || (channel === 'email' && !selected.email));

  const handleSend = async () => {
    if (!selected || !body.trim() || !currentTenantId) return;
    setSending(true);
    try {
      // Stale-state guard: re-evaluate policy at the exact moment of send so a
      // stale allow from a prior render can't leak through.
      const fresh = await dataProvider.communications.evaluatePolicy({
        clientId: selected.id,
        channel,
        messageClass,
      });
      setPolicy(fresh);
      if (!fresh.allowed) {
        toast({
          title: 'Send blocked by policy',
          description: (fresh.reasons.map((r) => REASON_COPY[r] ?? r).join('; ')) || 'Server-side policy denied this send.',
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
        to: '', // server resolves recipient from canonical client
        subject: channel === 'email' ? subject : undefined,
        body,
        threadId: `${channel}-${selected.id}`,
        messageClass,
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
    } catch (e) {
      toast({ title: 'Send failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const sendDisabled =
    sending ||
    checking ||
    !body.trim() ||
    !selected ||
    missingRecipient ||
    !canMutate ||
    !currentTenantId ||
    !!blocked;

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
      <DialogContent className="max-w-lg">
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
              <Select value={channel} onValueChange={(v: 'sms' | 'email') => setChannel(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Message class</Label>
              <Select value={messageClass} onValueChange={(v: MessageClass) => setMessageClass(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MESSAGE_CLASS_LABELS) as MessageClass[]).map((k) => (
                    <SelectItem key={k} value={k}>{MESSAGE_CLASS_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {channel === 'email' && (
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>

          <SuppressionBanner policy={displayPolicy} checking={checking} />
          {blocked && (
            <p className="text-xs text-muted-foreground">
              This send is blocked by server-side policy. Operators cannot override
              — resolve the underlying policy state or choose a different message class.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={sendDisabled} className="gap-2">
            <Send className="h-4 w-4" />
            {sendLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
