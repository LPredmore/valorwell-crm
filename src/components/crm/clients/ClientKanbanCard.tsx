import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MapPin, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getClientDisplayName, getTherapistDisplayName } from '@/lib/crm/status-config';
import type { CrmClient } from '@/lib/crm/types';

interface ClientKanbanCardProps {
  client: CrmClient;
  onClick: () => void;
  isDragging?: boolean;
}

export function ClientKanbanCard({ client, onClick, isDragging }: ClientKanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: client.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow",
        (isDragging || isSortableDragging) && "opacity-50 shadow-lg"
      )}
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        <div className="font-medium text-sm truncate">
          {getClientDisplayName(client)}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {client.pat_state && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {client.pat_state}
            </span>
          )}
          {client.primary_staff && (
            <span className="flex items-center gap-1 truncate">
              <User className="h-3 w-3" />
              {getTherapistDisplayName(client.primary_staff)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
