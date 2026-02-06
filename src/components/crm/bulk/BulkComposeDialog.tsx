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
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send } from 'lucide-react';

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

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) return;
    
    // Convert plain text to simple HTML (preserve line breaks)
    const bodyHtml = body
      .split('\n')
      .map(line => `<p>${line || '&nbsp;'}</p>`)
      .join('');
    
    await onSend(subject, bodyHtml);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isSending) {
      if (!newOpen) {
        setSubject('');
        setBody('');
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
            <Label htmlFor="body">Message</Label>
            <Textarea
              id="body"
              placeholder="Write your message here..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
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
