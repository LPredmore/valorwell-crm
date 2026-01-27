import { ArrowRight, MessageSquare, Mail, Link2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/crm/clients/StatusBadge';
import type { CrmActivityEvent, CrmNote, PatStatus } from '@/lib/crm/types';

type TimelineItem = 
  | { type: 'event'; data: CrmActivityEvent; timestamp: string }
  | { type: 'note'; data: CrmNote; timestamp: string };

interface ActivityItemProps {
  item: TimelineItem;
}

export function ActivityItem({ item }: ActivityItemProps) {
  const timeAgo = formatDistanceToNow(new Date(item.timestamp), { addSuffix: true });

  if (item.type === 'note') {
    const note = item.data;
    return (
      <div className="flex gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Note added</span>
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
          </div>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {note.note_content}
          </p>
        </div>
      </div>
    );
  }

  const event = item.data;

  switch (event.event_type) {
    case 'status_change':
      return (
        <div className="flex gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status changed</span>
              <span className="text-xs text-muted-foreground">{timeAgo}</span>
            </div>
            <div className="flex items-center gap-2">
              {event.old_value && (
                <>
                  <StatusBadge status={event.old_value as PatStatus} size="sm" />
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                </>
              )}
              <StatusBadge status={event.new_value as PatStatus} size="sm" />
            </div>
          </div>
        </div>
      );

    case 'email_sent':
      return (
        <div className="flex gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Email sent</span>
              <span className="text-xs text-muted-foreground">{timeAgo}</span>
            </div>
          </div>
        </div>
      );

    case 'email_received':
      return (
        <div className="flex gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent">
            <Mail className="h-4 w-4 text-accent-foreground" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Email received</span>
              <span className="text-xs text-muted-foreground">{timeAgo}</span>
            </div>
          </div>
        </div>
      );

    case 'conversation_linked':
      return (
        <div className="flex gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <Link2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Conversation linked</span>
              <span className="text-xs text-muted-foreground">{timeAgo}</span>
            </div>
          </div>
        </div>
      );

    default:
      return (
        <div className="flex gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{event.event_type}</span>
              <span className="text-xs text-muted-foreground">{timeAgo}</span>
            </div>
          </div>
        </div>
      );
  }
}
