import { HelpScoutConversation } from '@/lib/crm/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ArrowDownLeft, Send } from 'lucide-react';

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

  // Determine direction: "customer" = received from client, "user" = sent by staff
  // Default to "customer" (received) if source is missing - fail safe to show as needing attention
  const isReceived = conversation.source?.via !== 'user';
  
  // Needs reply if active AND received from customer
  const needsReply = conversation.status === 'active' && isReceived;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 border-b hover:bg-muted/50 transition-colors',
        isSelected && 'bg-muted',
        // Left border indicates direction: primary for received (needs attention), muted for sent
        isReceived ? 'border-l-2 border-l-primary' : 'border-l-2 border-l-muted-foreground/30'
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* Direction icon */}
          {isReceived ? (
            <ArrowDownLeft className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          ) : (
            <Send className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <span className={cn(
            "font-medium text-sm truncate",
            needsReply && "font-semibold"
          )}>
            {customerName}
          </span>
        </div>
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
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Direction badge */}
          <Badge 
            variant={isReceived ? "secondary" : "outline"} 
            className="text-[10px] capitalize"
          >
            {isReceived ? 'Received' : 'Sent'}
          </Badge>
          {/* Status badge */}
          <Badge variant={getStatusVariant(conversation.status)} className="text-[10px] capitalize">
            {conversation.status}
          </Badge>
        </div>
      </div>
    </button>
  );
}
