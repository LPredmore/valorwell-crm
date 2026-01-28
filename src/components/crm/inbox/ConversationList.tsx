import { HelpScoutConversation } from '@/lib/crm/types';
import { ConversationListItem } from './ConversationListItem';
import { Loader2, Inbox as InboxIcon, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConversationListProps {
  conversations: HelpScoutConversation[];
  isLoading: boolean;
  isError: boolean;
  selectedId: number | null;
  onSelect: (conversation: HelpScoutConversation) => void;
  onRetry?: () => void;
}

export function ConversationList({
  conversations,
  isLoading,
  isError,
  selectedId,
  onSelect,
  onRetry,
}: ConversationListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <AlertCircle className="h-8 w-8 text-destructive mb-3" />
        <p className="text-sm text-muted-foreground mb-3">Failed to load conversations</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try Again
          </Button>
        )}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <InboxIcon className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">No conversations</p>
        <p className="text-xs text-muted-foreground mt-1">
          Emails from clients will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      {conversations.map((conversation) => (
        <ConversationListItem
          key={conversation.id}
          conversation={conversation}
          isSelected={selectedId === conversation.id}
          onClick={() => onSelect(conversation)}
        />
      ))}
    </div>
  );
}
