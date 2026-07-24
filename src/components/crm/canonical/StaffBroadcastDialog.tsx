import { useRef, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { StaffMember } from '@/domain/operations';
import type { EmailContentDocument } from '@/features/email-studio/contracts';
import {
  StaffBroadcastEmailStudioComposer,
  type StaffBroadcastEmailStudioHandle,
} from '@/features/email-studio/staff';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { useResendSettings } from '@/hooks/crm/useResendSettings';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { processStaffBroadcast, type StaffBroadcastProcessResult } from '@/lib/crm/staff-broadcast-api';

type CreateStaffBroadcastResult = {
  bulk_send_id: string;
  recipient_count: number;
};

type UntypedSupabase = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export function StaffBroadcastDialog({
  open,
  onOpenChange,
  staff,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: StaffMember[];
  onComplete: () => void;
}) {
  const { tenantId } = useCrmAuth();
  const { isConnected } = useResendSettings();
  const { toast } = useToast();
  const studioRef = useRef<StaffBroadcastEmailStudioHandle>(null);
  const [subject, setSubject] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const createAndSend = async () => {
    if (!tenantId) return;
    if (!subject.trim()) {
      toast({ title: 'Subject required', variant: 'destructive' });
      return;
    }
    const content = await studioRef.current?.exportContent();
    if (!content || content.mode !== 'newsletter') {
      toast({
        title: 'Staff broadcast is not ready',
        description: 'Resolve the Email Studio validation errors before sending.',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);
    setProgress('Creating the controlled staff broadcast job…');
    try {
      const { data, error } = await (supabase as unknown as UntypedSupabase).rpc(
        'crm_create_bulk_staff_broadcast',
        {
          p_tenant_id: tenantId,
          p_staff_ids: staff.map((member) => member.id),
          p_subject: subject.trim(),
          p_content: content,
        },
      );
      if (error) throw new Error(error.message);
      const created = data as CreateStaffBroadcastResult;
      if (!created?.bulk_send_id) throw new Error('The staff broadcast job was not created.');

      let result: StaffBroadcastProcessResult | null = null;
      for (let pass = 0; pass < 30; pass += 1) {
        setProgress(result
          ? `Sending: ${result.sent} sent, ${result.failed} excluded or failed, ${result.remaining} remaining…`
          : `Sending to ${created.recipient_count} selected staff members…`);
        result = await processStaffBroadcast(tenantId, created.bulk_send_id);
        if (result.complete) break;
      }
      if (!result?.complete) throw new Error('The staff broadcast did not finish within the controlled processing limit.');

      toast({
        title: result.failed ? 'Staff broadcast completed with exclusions' : 'Staff broadcast sent',
        description: `${result.sent} sent. ${result.failed} excluded or failed.`,
        variant: result.sent === 0 && result.failed > 0 ? 'destructive' : 'default',
      });
      onComplete();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Staff broadcast failed',
        description: error instanceof Error ? error.message : 'Unable to complete the staff broadcast.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSending && onOpenChange(next)}>
      <DialogContent className="max-h-[95vh] max-w-[96vw] overflow-y-auto xl:max-w-7xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Staff broadcast</DialogTitle>
          <DialogDescription>
            {staff.length} selected staff member{staff.length === 1 ? '' : 's'}. Recipient status and email are revalidated immediately before delivery.
          </DialogDescription>
        </DialogHeader>

        {!isConnected ? (
          <Alert variant="destructive">
            <AlertTitle>Staff broadcast delivery is not configured</AlertTitle>
            <AlertDescription>Verify the Resend connection in CRM Settings before sending.</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="staff-broadcast-subject">Subject</Label>
          <Input
            id="staff-broadcast-subject"
            value={subject}
            maxLength={250}
            disabled={isSending}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Staff broadcast subject"
          />
        </div>

        <StaffBroadcastEmailStudioComposer ref={studioRef} readOnly={isSending} />
        {progress ? <p className="text-sm text-muted-foreground">{progress}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>Cancel</Button>
          <Button onClick={() => void createAndSend()} disabled={!tenantId || !isConnected || isSending || !subject.trim() || staff.length === 0}>
            {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            Send staff broadcast
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
