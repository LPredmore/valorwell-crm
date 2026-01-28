import { HelpScoutThread } from '@/lib/crm/types';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface ThreadMessageProps {
  thread: HelpScoutThread;
}

export function ThreadMessage({ thread }: ThreadMessageProps) {
  const isCustomer = thread.type === 'customer';
  const isNote = thread.type === 'note';
  
  const senderName = isCustomer
    ? [thread.customer?.first, thread.customer?.last].filter(Boolean).join(' ') || thread.customer?.email || 'Customer'
    : thread.createdBy
      ? [thread.createdBy.first, thread.createdBy.last].filter(Boolean).join(' ') || thread.createdBy.email
      : 'Staff';

  const formattedTime = format(new Date(thread.createdAt), 'MMM d, yyyy h:mm a');

  if (isNote) {
    return (
      <div className="mx-4 my-3 p-3 bg-muted/50 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-accent-foreground">Internal Note</span>
          <span className="text-xs text-muted-foreground">{senderName} • {formattedTime}</span>
        </div>
        <div
          className="text-sm prose prose-sm max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: thread.body }}
        />
      </div>
    );
  }

  return (
    <div className={cn('mx-4 my-3', isCustomer ? 'mr-12' : 'ml-12')}>
      <div
        className={cn(
          'rounded-lg p-4',
          isCustomer
            ? 'bg-muted'
            : 'bg-primary text-primary-foreground'
        )}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className={cn('text-xs font-medium', !isCustomer && 'text-primary-foreground/80')}>
            {senderName}
          </span>
          <span className={cn('text-xs', isCustomer ? 'text-muted-foreground' : 'text-primary-foreground/60')}>
            {formattedTime}
          </span>
        </div>
        <div
          className={cn(
            'text-sm prose prose-sm max-w-none',
            isCustomer ? 'dark:prose-invert' : 'prose-invert'
          )}
          dangerouslySetInnerHTML={{ __html: thread.body }}
        />
      </div>
    </div>
  );
}
