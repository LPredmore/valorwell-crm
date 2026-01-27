import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { ActivityItem } from './ActivityItem';
import { Loader2 } from 'lucide-react';
import type { CrmActivityEvent, CrmNote } from '@/lib/crm/types';

interface ActivityTimelineProps {
  clientId: string;
}

type TimelineItem = 
  | { type: 'event'; data: CrmActivityEvent; timestamp: string }
  | { type: 'note'; data: CrmNote; timestamp: string };

export function ActivityTimeline({ clientId }: ActivityTimelineProps) {
  const { tenantId, isAuthenticated } = useCrmAuth();

  // Fetch activity events
  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ['crm-activity-events', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_activity_events')
        .select(`
          id,
          tenant_id,
          client_id,
          event_type,
          old_value,
          new_value,
          metadata,
          created_by_profile_id,
          created_at
        `)
        .eq('client_id', clientId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data || []) as CrmActivityEvent[];
    },
    enabled: isAuthenticated && !!tenantId && !!clientId,
  });

  // Fetch notes
  const { data: notes, isLoading: notesLoading } = useQuery({
    queryKey: ['crm-notes', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_notes')
        .select(`
          id,
          tenant_id,
          client_id,
          conversation_id,
          created_by_profile_id,
          note_content,
          note_type,
          is_pinned,
          created_at,
          updated_at
        `)
        .eq('client_id', clientId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data || []) as CrmNote[];
    },
    enabled: isAuthenticated && !!tenantId && !!clientId,
  });

  const isLoading = eventsLoading || notesLoading;

  // Combine and sort timeline items
  const timelineItems: TimelineItem[] = [
    ...(events || []).map(event => ({
      type: 'event' as const,
      data: event,
      timestamp: event.created_at,
    })),
    ...(notes || []).map(note => ({
      type: 'note' as const,
      data: note,
      timestamp: note.created_at,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (timelineItems.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {timelineItems.map((item) => (
        <ActivityItem
          key={`${item.type}-${item.type === 'event' ? item.data.id : item.data.id}`}
          item={item}
        />
      ))}
    </div>
  );
}
