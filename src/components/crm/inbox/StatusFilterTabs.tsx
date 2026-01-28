import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ArrowDownLeft, Send, Inbox } from 'lucide-react';

interface StatusFilterTabsProps {
  value: 'all' | 'active' | 'pending' | 'closed';
  onChange: (value: 'all' | 'active' | 'pending' | 'closed') => void;
  direction: 'all' | 'received' | 'sent';
  onDirectionChange: (value: 'all' | 'received' | 'sent') => void;
}

export function StatusFilterTabs({ value, onChange, direction, onDirectionChange }: StatusFilterTabsProps) {
  return (
    <div className="space-y-2">
      {/* Status filter tabs */}
      <Tabs value={value} onValueChange={(v) => onChange(v as typeof value)}>
        <TabsList className="w-full grid grid-cols-4 h-8">
          <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
          <TabsTrigger value="active" className="text-xs">Active</TabsTrigger>
          <TabsTrigger value="pending" className="text-xs">Pending</TabsTrigger>
          <TabsTrigger value="closed" className="text-xs">Closed</TabsTrigger>
        </TabsList>
      </Tabs>
      
      {/* Direction filter toggle */}
      <ToggleGroup 
        type="single" 
        value={direction} 
        onValueChange={(v) => v && onDirectionChange(v as typeof direction)}
        className="w-full justify-start"
      >
        <ToggleGroupItem value="all" aria-label="Show all" className="flex-1 text-xs gap-1 h-7">
          <Inbox className="h-3 w-3" />
          All
        </ToggleGroupItem>
        <ToggleGroupItem value="received" aria-label="Show received" className="flex-1 text-xs gap-1 h-7">
          <ArrowDownLeft className="h-3 w-3" />
          Received
        </ToggleGroupItem>
        <ToggleGroupItem value="sent" aria-label="Show sent" className="flex-1 text-xs gap-1 h-7">
          <Send className="h-3 w-3" />
          Sent
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
