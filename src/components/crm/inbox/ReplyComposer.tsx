import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2, Send } from 'lucide-react';
import { useReplyToConversation } from '@/hooks/crm/useReplyToConversation';

interface ReplyComposerProps {
  conversationId: number;
  onSuccess?: () => void;
}

export function ReplyComposer({ conversationId, onSuccess }: ReplyComposerProps) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'active' | 'pending' | 'closed'>('pending');
  const { mutate: sendReply, isPending } = useReplyToConversation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    sendReply(
      { conversationId, text: text.trim(), status },
      {
        onSuccess: () => {
          setText('');
          onSuccess?.();
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="border-t bg-card p-4 space-y-3">
      <div>
        <Textarea
          placeholder="Type your reply..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="resize-none"
          disabled={isPending}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="status-select" className="text-sm text-muted-foreground whitespace-nowrap">
            After sending:
          </Label>
          <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'pending' | 'closed')}>
            <SelectTrigger id="status-select" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Keep Active</SelectItem>
              <SelectItem value="pending">Set Pending</SelectItem>
              <SelectItem value="closed">Close</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={isPending || !text.trim()}>
          {isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Send Reply
        </Button>
      </div>
    </form>
  );
}
