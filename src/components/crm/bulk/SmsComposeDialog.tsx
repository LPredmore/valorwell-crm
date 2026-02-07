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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, MessageSquare } from 'lucide-react';

interface SmsComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientCount: number;
  onSend: (bodyText: string) => Promise<void>;
  isSending: boolean;
  recipientLabel?: 'client' | 'staff member';
}

export function SmsComposeDialog({
  open,
  onOpenChange,
  recipientCount,
  onSend,
  isSending,
  recipientLabel = 'client',
}: SmsComposeDialogProps) {
  const [body, setBody] = useState('');

  const handleSend = async () => {
    if (!body.trim()) return;
    await onSend(body);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isSending) {
      if (!newOpen) {
        setBody('');
      }
      onOpenChange(newOpen);
    }
  };

  const isValid = body.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Compose Text Message</DialogTitle>
          <DialogDescription>
            Sending individual text messages to {recipientCount} {recipientLabel}{recipientCount !== 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="sms-body">Message</Label>
              <span className="text-xs text-muted-foreground">
                {body.length} characters
              </span>
            </div>
            <Textarea
              id="sms-body"
              placeholder="Write your text message here..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              disabled={isSending}
              className="resize-none"
            />
          </div>
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
                <MessageSquare className="h-4 w-4" />
                Send to {recipientCount} {recipientLabel === 'staff member' ? 'Staff Member' : 'Client'}{recipientCount !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
