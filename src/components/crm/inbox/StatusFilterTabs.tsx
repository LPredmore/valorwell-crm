import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface StatusFilterTabsProps {
  value: 'all' | 'active' | 'pending' | 'closed';
  onChange: (value: 'all' | 'active' | 'pending' | 'closed') => void;
}

export function StatusFilterTabs({ value, onChange }: StatusFilterTabsProps) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as typeof value)}>
      <TabsList className="w-full grid grid-cols-4 h-8">
        <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
        <TabsTrigger value="active" className="text-xs">Active</TabsTrigger>
        <TabsTrigger value="pending" className="text-xs">Pending</TabsTrigger>
        <TabsTrigger value="closed" className="text-xs">Closed</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
