import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RichTextEditor } from '@/components/crm/shared/RichTextEditor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2, Send } from 'lucide-react';
import { useReplyToConversation } from '@/hooks/crm/useReplyToConversation';
import { SignatureSelect, useDefaultSignatureId } from '@/components/crm/shared/SignatureSelect';
import { useEmailSignatures, getSignatureHtml } from '@/hooks/crm/useEmailSignatures';

interface ReplyComposerProps {
  conversationId: number;
  onSuccess?: () => void;
}

export function ReplyComposer({ conversationId, onSuccess }: ReplyComposerProps) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'active' | 'pending' | 'closed'>('pending');
  const defaultSigId = useDefaultSignatureId();
  const [signatureId, setSignatureId] = useState<string>(defaultSigId);
  const { data: signatures } = useEmailSignatures();
  const { mutate: sendReply, isPending } = useReplyToConversation();

  // Sync default once loaded
  const [initialized, setInitialized] = useState(false);
  if (!initialized && defaultSigId !== 'none') {
    setSignatureId(defaultSigId);
    setInitialized(true);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    let finalBody = text.trim();
    if (signatureId && signatureId !== 'none') {
      const sig = signatures?.find((s) => s.id === signatureId);
      if (sig) {
        finalBody += '<br><br>' + getSignatureHtml(sig);
      }
    }

    sendReply(
      { conversationId, text: finalBody, status },
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
        <RichTextEditor
          value={text}
          onChange={setText}
          placeholder="Type your reply..."
          disabled={isPending}
          minHeight="100px"
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
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
          <SignatureSelect value={signatureId} onChange={setSignatureId} />
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
