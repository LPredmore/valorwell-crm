import { HelpScoutConversation } from '@/lib/crm/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface ConversationListItemProps {
  conversation: HelpScoutConversation;
  isSelected: boolean;
  onClick: () => void;
}

export function ConversationListItem({ conversation, isSelected, onClick }: ConversationListItemProps) {
  const customerName = [conversation.primaryCustomer?.first, conversation.primaryCustomer?.last]
    .filter(Boolean)
    .join(' ') || conversation.primaryCustomer?.email || 'Unknown';

  const timeAgo = formatDistanceToNow(new Date(conversation.userUpdatedAt || conversation.createdAt), {
    addSuffix: true,
  });

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'active':
        return 'default';
      case 'pending':
        return 'secondary';
      case 'closed':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  // Use server-computed needsReply (based on lastMessageBy from threads)
  const needsReply = conversation.needsReply ?? false;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 border-b hover:bg-muted/50 transition-colors',
        isSelected && 'bg-muted',
        // Highlight items needing reply with primary border
        needsReply ? 'border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className={cn(
          "font-medium text-sm truncate flex-1",
          needsReply && "font-semibold"
        )}>
          {customerName}
        </span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo}</span>
      </div>
      <div className={cn(
        "text-sm truncate mb-1",
        needsReply ? "font-medium" : "font-normal"
      )}>
        {conversation.subject || '(No subject)'}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground truncate flex-1">
          {conversation.preview || 'No preview available'}
        </span>
        {/* Status badge */}
        <Badge variant={getStatusVariant(conversation.status)} className="text-[10px] capitalize">
          {conversation.status}
        </Badge>
      </div>
    </button>
  );
}
