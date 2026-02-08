import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { User, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { SmsThread as SmsThreadType } from '@/hooks/crm/useSmsConversations';

interface SmsThreadProps {
  thread: SmsThreadType;
}

export function SmsThread({ thread }: SmsThreadProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-lg truncate">
              {thread.client_name || thread.phone}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground">{thread.phone}</span>
              <Badge variant="outline" className="text-xs">
                {thread.messages.length} messages
              </Badge>
            </div>
          </div>
          {thread.client_id && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/crm/clients/${thread.client_id}`}>
                <User className="h-4 w-4 mr-1" />
                View Client
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {thread.messages.map((message) => {
            const isInbound = message.direction === 'inbound';

            return (
              <div
                key={message.id}
                className={cn('flex gap-3', isInbound ? 'justify-start' : 'justify-end')}
              >
                <div
                  className={cn(
                    'max-w-[75%] rounded-lg p-3',
                    isInbound ? 'bg-muted' : 'bg-primary text-primary-foreground'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {isInbound ? (
                      <ArrowDownLeft className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ArrowUpRight className="h-3 w-3 opacity-70" />
                    )}
                    <span className={cn('text-xs', isInbound ? 'text-muted-foreground' : 'opacity-70')}>
                      {isInbound ? 'Received' : 'Sent'} • {format(new Date(message.timestamp), 'MMM d, h:mm a')}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{message.message || '(No message content)'}</p>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer placeholder for future reply capability */}
      <div className="border-t p-4 bg-muted/30">
        <p className="text-sm text-muted-foreground text-center">
          SMS reply from this view coming soon
        </p>
      </div>
    </div>
  );
}
