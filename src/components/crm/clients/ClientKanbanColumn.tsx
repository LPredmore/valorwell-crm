import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ClientKanbanCard } from './ClientKanbanCard';
import type { StatusConfig } from '@/lib/crm/status-config';
import type { CrmClient, PatStatus } from '@/lib/crm/types';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ClientKanbanColumnProps {
  status: PatStatus;
  config: StatusConfig;
  clients: CrmClient[];
  onClientClick: (clientId: string) => void;
  onQuickView: (client: CrmClient) => void;
}

export function ClientKanbanColumn({ status, config, clients, onClientClick, onQuickView }: ClientKanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col w-72 rounded-lg bg-muted/50 transition-colors",
        isOver && "bg-muted"
      )}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: config.color }}
          />
          <span className="font-medium text-sm">{config.label}</span>
        </div>
        <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full">
          {clients.length}
        </span>
      </div>

      {/* Cards */}
      <ScrollArea className="flex-1 p-2">
        <SortableContext
          items={clients.map(c => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {clients.map((client) => (
              <ClientKanbanCard
                key={client.id}
                client={client}
                onClick={() => onQuickView(client)}
                onDoubleClick={() => onClientClick(client.id)}
              />
            ))}
            {clients.length === 0 && (
              <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
                No clients
              </div>
            )}
          </div>
        </SortableContext>
      </ScrollArea>
    </div>
  );
}
