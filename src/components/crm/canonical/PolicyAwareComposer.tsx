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

type MessageClass = 'ordinary_campaign_follow_up' | 'critical_operational' | 'transactional' | 'manual';

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
  const [messageClass, setMessageClass] = useState<MessageClass>('manual');
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

  // Reset composer whenever it opens or the caller's preselection changes.
  useEffect(() => {
    if (!open) return;
    setChannel(defaultChannel);
    setMessageClass('manual');
    setSubject('');
    setBody('');
    setPolicy(null);
    setSelected(
      clientId
        ? { id: clientId, displayName: clientDisplayName ?? 'Selected client', email: clientEmail, phone: clientPhone }
        : null,
    );
  }, [open, defaultChannel, clientId, clientDisplayName, clientEmail, clientPhone]);

  // Reset policy when channel/message class changes (fresh evaluation required).
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
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [open, activeClientId, channel, messageClass]);

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
      });
      qc.invalidateQueries({ queryKey: ['crm-comms'] });
      const suppressed = result.status === 'suppressed' || (blocked && !policy?.requiresReview);
      toast({
        title: suppressed ? 'Message suppressed' : 'Message sent',
        description: suppressed ? (result.suppressionReason ?? policy?.reasons.join('; ')) : undefined,
      });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Send failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const sendDisabled =
    sending ||
    !body.trim() ||
    !selected ||
    missingRecipient ||
    !canMutate ||
    !currentTenantId ||
    (!!blocked && !policy?.requiresReview);

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
                {channel === 'sms' ? 'Sends to' : 'Sends to'}: {recipientHint}
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
                  <SelectItem value="manual">Manual outreach</SelectItem>
                  <SelectItem value="ordinary_campaign_follow_up">Ordinary follow-up</SelectItem>
                  <SelectItem value="critical_operational">Critical operational</SelectItem>
                  <SelectItem value="transactional">Transactional</SelectItem>
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

          <SuppressionBanner policy={policy} checking={checking} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={sendDisabled} className="gap-2">
            <Send className="h-4 w-4" />
            {!canMutate ? 'Read-only' : !selected ? 'Select a client' : missingRecipient ? 'No recipient on file' : blocked ? 'Send with override' : sending ? 'Sending…' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
