import { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Check, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useKanbanConfig, DEFAULT_KANBAN_STATUSES } from '@/hooks/crm/useKanbanConfig';
import { ALL_STATUSES, STATUS_CONFIG } from '@/lib/crm/status-config';
import type { PatStatus } from '@/lib/crm/types';
import { useToast } from '@/hooks/use-toast';

interface SortableStatusItemProps {
  status: PatStatus;
  isVisible: boolean;
  onToggle: (status: PatStatus) => void;
}

function SortableStatusItem({ status, isVisible, onToggle }: SortableStatusItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ 
    id: status,
    disabled: !isVisible,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const config = STATUS_CONFIG[status];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-lg border p-3 bg-card ${
        isDragging ? 'opacity-50 shadow-lg' : ''
      } ${!isVisible ? 'opacity-60' : ''}`}
    >
      {isVisible && (
        <button
          className="cursor-grab touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
      {!isVisible && <div className="w-4" />}
      
      <Checkbox
        checked={isVisible}
        onCheckedChange={() => onToggle(status)}
        id={`status-${status}`}
      />
      
      <div className="flex-1">
        <label 
          htmlFor={`status-${status}`}
          className="cursor-pointer font-medium text-sm"
        >
          {config.label}
        </label>
      </div>
      
      <Badge 
        variant="secondary" 
        className={`${config.bgColor} ${config.textColor} text-xs`}
      >
        {config.category}
      </Badge>
      
      {isVisible ? (
        <Eye className="h-4 w-4 text-muted-foreground" />
      ) : (
        <EyeOff className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}

export function KanbanConfigPanel() {
  const { visibleStatuses, isLoading, isAdmin, saveConfig, isSaving } = useKanbanConfig();
  const { toast } = useToast();
  const [localStatuses, setLocalStatuses] = useState<PatStatus[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize local state from server data
  useEffect(() => {
    if (!isLoading) {
      setLocalStatuses(visibleStatuses);
    }
  }, [visibleStatuses, isLoading]);

  // Get hidden statuses (all statuses minus visible ones)
  const hiddenStatuses = ALL_STATUSES.filter(s => !localStatuses.includes(s));

  const handleToggle = (status: PatStatus) => {
    setLocalStatuses(prev => {
      if (prev.includes(status)) {
        // Remove from visible
        return prev.filter(s => s !== status);
      } else {
        // Add to visible (at the end)
        return [...prev, status];
      }
    });
    setHasChanges(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setLocalStatuses(prev => {
      const oldIndex = prev.indexOf(active.id as PatStatus);
      const newIndex = prev.indexOf(over.id as PatStatus);
      return arrayMove(prev, oldIndex, newIndex);
    });
    setHasChanges(true);
  };

  const handleSave = () => {
    saveConfig(localStatuses, {
      onSuccess: () => {
        toast({
          title: 'Configuration saved',
          description: 'Kanban columns have been updated.',
        });
        setHasChanges(false);
      },
      onError: (error) => {
        toast({
          title: 'Error saving configuration',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      },
    });
  };

  const handleReset = () => {
    setLocalStatuses(DEFAULT_KANBAN_STATUSES);
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Kanban Column Configuration</CardTitle>
          <CardDescription>
            Only administrators can modify the Kanban column configuration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Current visible columns: {visibleStatuses.map(s => STATUS_CONFIG[s].label).join(', ')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kanban Column Configuration</CardTitle>
        <CardDescription>
          Drag to reorder columns or toggle visibility. Changes affect all team members.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Visible statuses (sortable) */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Visible Columns ({localStatuses.length})
          </h4>
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={localStatuses} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {localStatuses.map((status) => (
                  <SortableStatusItem
                    key={status}
                    status={status}
                    isVisible={true}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* Hidden statuses */}
        {hiddenStatuses.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
              <EyeOff className="h-4 w-4" />
              Hidden Columns ({hiddenStatuses.length})
            </h4>
            <div className="space-y-2">
              {hiddenStatuses.map((status) => (
                <SortableStatusItem
                  key={status}
                  status={status}
                  isVisible={false}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button variant="outline" onClick={handleReset}>
            Reset to Default
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!hasChanges || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Save Configuration
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
