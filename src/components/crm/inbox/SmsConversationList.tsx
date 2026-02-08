import { Loader2, MessageSquare, User, Circle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { SmsThread } from '@/hooks/crm/useSmsConversations';

interface SmsConversationListProps {
  threads: SmsThread[];
  isLoading: boolean;
  isError: boolean;
  selectedPhone: string | null;
  onSelect: (thread: SmsThread) => void;
  onRetry: () => void;
}

export function SmsConversationList({
  threads,
  isLoading,
  isError,
  selectedPhone,
  onSelect,
  onRetry,
}: SmsConversationListProps) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
        <p className="text-sm text-muted-foreground mb-2">Failed to load SMS</p>
        <button onClick={onRetry} className="text-sm text-primary hover:underline">
          Try again
        </button>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
        <MessageSquare className="h-8 w-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No SMS messages yet</p>
      </div>
    );
  }

  const normalizePhone = (phone: string) => phone.replace(/\D/g, '').slice(-10);

  return (
    <ScrollArea className="flex-1">
      <div className="divide-y">
        {threads.map((thread) => {
          const isSelected = selectedPhone && normalizePhone(selectedPhone) === normalizePhone(thread.phone);
          const lastMessage = thread.messages[thread.messages.length - 1];
          const hasInbound = thread.messages.some((m) => m.direction === 'inbound');

          return (
            <div
              key={thread.phone}
              className={cn(
                'p-3 cursor-pointer hover:bg-muted/50 transition-colors',
                isSelected && 'bg-muted'
              )}
              onClick={() => onSelect(thread)}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center relative">
                  <User className="h-4 w-4 text-muted-foreground" />
                  {thread.hasUnread && (
                    <Circle className="absolute -top-0.5 -right-0.5 h-3 w-3 fill-primary text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn(
                      'text-sm truncate',
                      thread.hasUnread ? 'font-semibold' : 'font-medium',
                      hasInbound && 'text-primary'
                    )}>
                      {thread.client_name || thread.phone}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: true })}
                    </span>
                  </div>
                  {thread.client_name && (
                    <p className="text-xs text-muted-foreground truncate">{thread.phone}</p>
                  )}
                  <p className={cn(
                    'text-sm truncate mt-0.5',
                    thread.hasUnread ? 'text-foreground font-medium' : 'text-muted-foreground'
                  )}>
                    {lastMessage?.direction === 'inbound' ? '← ' : '→ '}
                    {lastMessage?.message || '(No message)'}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
