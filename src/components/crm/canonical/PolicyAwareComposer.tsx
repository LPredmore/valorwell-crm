import { useEffect, useState } from 'react';
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
import { useCanMutate } from '@/components/crm/auth/CrmMutationGate';

type MessageClass = 'ordinary_campaign_follow_up' | 'critical_operational' | 'transactional' | 'manual';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  defaultChannel?: 'sms' | 'email';
  defaultTo?: string;
}

export function PolicyAwareComposer({ open, onOpenChange, clientId, defaultChannel = 'sms', defaultTo = '' }: Props) {
  const canMutate = useCanMutate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [channel, setChannel] = useState<'sms' | 'email'>(defaultChannel);
  const [messageClass, setMessageClass] = useState<MessageClass>('manual');
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [policy, setPolicy] = useState<CommunicationPolicyResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChannel(defaultChannel);
    setTo(defaultTo);
    setSubject('');
    setBody('');
    setPolicy(null);
  }, [open, defaultChannel, defaultTo]);

  useEffect(() => {
    if (!open || !clientId) return;
    let cancelled = false;
    setChecking(true);
    dataProvider.communications
      .evaluatePolicy({ clientId, channel, messageClass })
      .then((r) => { if (!cancelled) setPolicy(r); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [open, clientId, channel, messageClass]);

  const blocked = policy && !policy.allowed;

  const handleSend = async () => {
    if (!body.trim() || !to.trim()) return;
    setSending(true);
    try {
      await dataProvider.communications.send({
        tenantId: 'tenant-1',
        clientId,
        channel,
        direction: 'outbound',
        from: 'crm@valorwell.org',
        to,
        subject: channel === 'email' ? subject : undefined,
        body,
        threadId: `${channel}-${clientId}`,
      });
      qc.invalidateQueries({ queryKey: ['crm-comms'] });
      toast({ title: blocked ? 'Message suppressed' : 'Message sent', description: blocked ? policy?.reasons.join('; ') : undefined });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Send failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New {channel === 'sms' ? 'SMS' : 'Email'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
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

          <div className="space-y-1.5">
            <Label>To</Label>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === 'sms' ? '+15555550123' : 'client@example.com'} />
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
          <Button
            onClick={handleSend}
            disabled={
              sending ||
              !body.trim() ||
              !to.trim() ||
              !canMutate ||
              (!!blocked && !policy?.requiresReview)
            }
            className="gap-2"
          >
            <Send className="h-4 w-4" />
            {!canMutate ? 'Read-only' : blocked ? 'Send with override' : sending ? 'Sending…' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
