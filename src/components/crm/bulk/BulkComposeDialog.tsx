import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/crm/shared/RichTextEditor';
import { Loader2, Send } from 'lucide-react';
import { SignatureSelect, useDefaultSignatureId } from '@/components/crm/shared/SignatureSelect';
import { useEmailSignatures, getSignatureHtml } from '@/hooks/crm/useEmailSignatures';

interface BulkComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientCount: number;
  onSend: (subject: string, bodyHtml: string) => Promise<void>;
  isSending: boolean;
  recipientLabel?: 'client' | 'staff member';
}

export function BulkComposeDialog({
  open,
  onOpenChange,
  recipientCount,
  onSend,
  isSending,
  recipientLabel = 'client',
}: BulkComposeDialogProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const defaultSigId = useDefaultSignatureId();
  const [signatureId, setSignatureId] = useState<string>(defaultSigId);
  const { data: signatures } = useEmailSignatures();

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) return;

    let finalBody = body;
    if (signatureId && signatureId !== 'none') {
      const sig = signatures?.find((s) => s.id === signatureId);
      if (sig) {
        finalBody += '<br><br>' + getSignatureHtml(sig);
      }
    }

    await onSend(subject, finalBody);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isSending) {
      if (!newOpen) {
        setSubject('');
        setBody('');
        setSignatureId(defaultSigId);
      }
      onOpenChange(newOpen);
    }
  };

  const isValid = subject.trim().length > 0 && body.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Compose Email</DialogTitle>
          <DialogDescription>
            Sending individual emails to {recipientCount} {recipientLabel}{recipientCount !== 1 ? 's' : ''}.
            Each recipient will receive their own conversation.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              placeholder="Enter email subject..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isSending}
            />
          </div>
          
          <div className="space-y-2">
            <Label>Message</Label>
            <RichTextEditor
              value={body}
              onChange={setBody}
              placeholder="Write your message here..."
              disabled={isSending}
              minHeight="200px"
            />
          </div>

          <SignatureSelect value={signatureId} onChange={setSignatureId} />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!isValid || isSending}
            className="gap-2"
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
            <>
                <Send className="h-4 w-4" />
                Send to {recipientCount} {recipientLabel === 'staff member' ? 'Staff Member' : 'Client'}{recipientCount !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
