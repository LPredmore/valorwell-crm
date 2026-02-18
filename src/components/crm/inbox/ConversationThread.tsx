import { useConversationDetail } from '@/hooks/crm/useConversationDetail';
import { HelpScoutConversation } from '@/lib/crm/types';
import { ThreadMessage } from './ThreadMessage';
import { ReplyComposer } from './ReplyComposer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, User } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ConversationThreadProps {
  conversation: HelpScoutConversation;
}

export function ConversationThread({ conversation }: ConversationThreadProps) {
  const { data: detail, isLoading, isError, refetch } = useConversationDetail({
    conversationId: conversation.id,
  });

  const threads = detail?._embedded?.threads || [];
  // Reverse threads to show oldest first (chronological order)
  const sortedThreads = [...threads].reverse();

  const customerName = [conversation.primaryCustomer?.first, conversation.primaryCustomer?.last]
    .filter(Boolean)
    .join(' ') || conversation.primaryCustomer?.email || 'Unknown';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-lg truncate">{conversation.subject || '(No subject)'}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground">{customerName}</span>
              <Badge variant="outline" className="capitalize text-xs">
                {conversation.status}
              </Badge>
            </div>
          </div>
          {conversation.client_id && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/crm/clients/${conversation.client_id}`}>
                <User className="h-4 w-4 mr-1" />
                View Client
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Thread messages */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground mb-3">Failed to load conversation</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try Again
            </Button>
          </div>
        ) : sortedThreads.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">No messages in this conversation</p>
          </div>
        ) : (
          <div className="py-2">
            {sortedThreads.map((thread) => (
              <ThreadMessage key={thread.id} thread={thread} />
            ))}
          </div>
        )}
      </div>

      {/* Reply Composer */}
      <ReplyComposer conversationId={conversation.id} clientId={conversation.client_id} onSuccess={() => refetch()} />
    </div>
  );
}
