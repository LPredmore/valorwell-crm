import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ClientKanbanColumn } from './ClientKanbanColumn';
import { ClientKanbanCard } from './ClientKanbanCard';
import { getStatusConfig } from '@/lib/crm/status-config';
import { useKanbanConfig } from '@/hooks/crm/useKanbanConfig';
import type { CrmClient, PatStatus } from '@/lib/crm/types';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface ClientKanbanProps {
  clientsByStatus: Record<PatStatus, CrmClient[]>;
  isLoading: boolean;
  onClientClick: (clientId: string) => void;
}

export function ClientKanban({ clientsByStatus, isLoading, onClientClick }: ClientKanbanProps) {
  const [activeClient, setActiveClient] = useState<CrmClient | null>(null);
  const { visibleStatuses, isLoading: configLoading } = useKanbanConfig();

  if (isLoading || configLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const clientId = active.id as string;
    
    // Find the client across all statuses
    for (const clients of Object.values(clientsByStatus)) {
      const client = clients.find(c => c.id === clientId);
      if (client) {
        setActiveClient(client);
        break;
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveClient(null);
    
    const { active, over } = event;
    if (!over) return;

    const clientId = active.id as string;
    const newStatus = over.id as PatStatus;

    // Find current status
    let currentStatus: PatStatus | null = null;
    for (const [status, clients] of Object.entries(clientsByStatus)) {
      if (clients.some(c => c.id === clientId)) {
        currentStatus = status as PatStatus;
        break;
      }
    }

    if (currentStatus && currentStatus !== newStatus) {
      // TODO: Implement status change mutation
      console.log(`Moving client ${clientId} from ${currentStatus} to ${newStatus}`);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="flex gap-4 p-4 min-w-max">
        <DndContext
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {visibleStatuses.map((status) => {
            const clients = clientsByStatus[status] || [];
            const config = getStatusConfig(status);

            return (
              <ClientKanbanColumn
                key={status}
                status={status}
                config={config}
                clients={clients}
                onClientClick={onClientClick}
              />
            );
          })}

          <DragOverlay>
            {activeClient && (
              <ClientKanbanCard 
                client={activeClient} 
                onClick={() => {}}
                isDragging
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
