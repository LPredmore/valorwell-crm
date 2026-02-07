import { Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { STAFF_STATUS_CONFIG, type StaffFilters as StaffFiltersType, type StaffStatus } from '@/lib/crm/staff-types';

// US States for filter
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

interface StaffFiltersProps {
  filters: StaffFiltersType;
  onChange: (filters: Partial<StaffFiltersType>) => void;
}

export function StaffFilters({ filters, onChange }: StaffFiltersProps) {
  const activeFilterCount = 
    filters.statuses.length + 
    filters.states.length;

  const handleStatusToggle = (status: StaffStatus) => {
    const newStatuses = filters.statuses.includes(status)
      ? filters.statuses.filter(s => s !== status)
      : [...filters.statuses, status];
    onChange({ statuses: newStatuses });
  };

  const handleStateToggle = (state: string) => {
    const newStates = filters.states.includes(state)
      ? filters.states.filter(s => s !== state)
      : [...filters.states, state];
    onChange({ states: newStates });
  };

  const handleClearFilters = () => {
    onChange({ statuses: [], states: [] });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 min-w-5 rounded-full px-1.5">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <ScrollArea className="[&>[data-radix-scroll-area-viewport]]:max-h-[70vh]">
          <div className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Filters</h4>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                  Clear all
                </Button>
              )}
            </div>

            {/* Status filter */}
            <div className="space-y-2">
              <h5 className="text-sm font-medium text-muted-foreground">Status</h5>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(STAFF_STATUS_CONFIG) as StaffStatus[]).map(status => (
                  <label
                    key={status}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={filters.statuses.includes(status)}
                      onCheckedChange={() => handleStatusToggle(status)}
                    />
                    {STAFF_STATUS_CONFIG[status].label}
                  </label>
                ))}
              </div>
            </div>

            {/* State filter */}
            <div className="space-y-2">
              <h5 className="text-sm font-medium text-muted-foreground">State</h5>
              <div className="max-h-40 overflow-y-auto rounded border p-2">
                <div className="grid grid-cols-4 gap-1">
                  {US_STATES.map(state => (
                    <label
                      key={state}
                      className="flex items-center gap-1.5 text-xs cursor-pointer"
                    >
                      <Checkbox
                        checked={filters.states.includes(state)}
                        onCheckedChange={() => handleStateToggle(state)}
                        className="h-3.5 w-3.5"
                      />
                      {state}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
