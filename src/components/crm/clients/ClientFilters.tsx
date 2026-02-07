import { Filter, Tag, X, CalendarIcon, Users } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ALL_STATUSES, STATUS_CONFIG } from '@/lib/crm/status-config';
import { useTagOptions } from '@/hooks/crm/useTagOptions';
import { cn } from '@/lib/utils';
import type { ClientFilters as ClientFiltersType, PatStatus } from '@/lib/crm/types';

interface ClientFiltersProps {
  filters: ClientFiltersType;
  onChange: (filters: Partial<ClientFiltersType>) => void;
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

export function ClientFilters({ filters, onChange }: ClientFiltersProps) {
  const { data: tagOptions = [], isLoading: tagsLoading } = useTagOptions();
  
  const activeFilterCount = 
    filters.statuses.length + 
    filters.states.length + 
    filters.tags.length +
    (filters.joinedDateFrom ? 1 : 0) +
    (filters.joinedDateTo ? 1 : 0) +
    (filters.activeCampaign && filters.activeCampaign !== 'all' ? 1 : 0);

  const handleStatusChange = (status: PatStatus, checked: boolean) => {
    const newStatuses = checked
      ? [...filters.statuses, status]
      : filters.statuses.filter(s => s !== status);
    onChange({ statuses: newStatuses });
  };

  const handleStateChange = (state: string, checked: boolean) => {
    const newStates = checked
      ? [...filters.states, state]
      : filters.states.filter(s => s !== state);
    onChange({ states: newStates });
  };

  const handleTagChange = (tag: string, checked: boolean) => {
    const newTags = checked
      ? [...filters.tags, tag]
      : filters.tags.filter(t => t !== tag);
    onChange({ tags: newTags });
  };

  const clearFilters = () => {
    onChange({ 
      statuses: [], 
      states: [], 
      tags: [],
      joinedDateFrom: undefined,
      joinedDateTo: undefined,
      activeCampaign: 'all',
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 w-5 rounded-full p-0 text-xs">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <ScrollArea className="[&>[data-radix-scroll-area-viewport]]:max-h-[70vh]">
          <div className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Filters</h4>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear all
                </Button>
              )}
            </div>

            {/* Active Campaign Filter */}
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                Active Campaign
              </Label>
              <Select
                value={filters.activeCampaign || 'all'}
                onValueChange={(value: 'all' | 'yes' | 'no') => onChange({ activeCampaign: value })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Joined Date Filter */}
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <CalendarIcon className="h-4 w-4" />
                Joined Date
              </Label>
              <div className="flex items-center gap-2">
                {/* From Date */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "flex-1 justify-start text-left font-normal",
                        !filters.joinedDateFrom && "text-muted-foreground"
                      )}
                    >
                      {filters.joinedDateFrom ? (
                        format(filters.joinedDateFrom, "MMM d, yyyy")
                      ) : (
                        <span>From</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={filters.joinedDateFrom}
                      onSelect={(date) => onChange({ joinedDateFrom: date || undefined })}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {filters.joinedDateFrom && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onChange({ joinedDateFrom: undefined })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* To Date */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "flex-1 justify-start text-left font-normal",
                        !filters.joinedDateTo && "text-muted-foreground"
                      )}
                    >
                      {filters.joinedDateTo ? (
                        format(filters.joinedDateTo, "MMM d, yyyy")
                      ) : (
                        <span>To</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={filters.joinedDateTo}
                      onSelect={(date) => onChange({ joinedDateTo: date || undefined })}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {filters.joinedDateTo && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onChange({ joinedDateTo: undefined })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Tags Filter */}
            {tagOptions.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Tags
                </Label>
                <div className="flex flex-wrap gap-2 max-h-24 overflow-auto">
                  {tagOptions.map((tag) => (
                    <Badge
                      key={tag}
                      variant={filters.tags.includes(tag) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => handleTagChange(tag, !filters.tags.includes(tag))}
                    >
                      {tag}
                      {filters.tags.includes(tag) && (
                        <X className="ml-1 h-3 w-3" />
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Status Filter */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Status</Label>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-auto">
                {ALL_STATUSES.map((status) => (
                  <div key={status} className="flex items-center space-x-2">
                    <Checkbox
                      id={`status-${status}`}
                      checked={filters.statuses.includes(status)}
                      onCheckedChange={(checked) => 
                        handleStatusChange(status, checked as boolean)
                      }
                    />
                    <Label
                      htmlFor={`status-${status}`}
                      className="text-xs cursor-pointer"
                    >
                      {STATUS_CONFIG[status].label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* State Filter */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">State</Label>
              <div className="grid grid-cols-5 gap-1 max-h-32 overflow-auto">
                {US_STATES.map((state) => (
                  <div key={state} className="flex items-center space-x-1">
                    <Checkbox
                      id={`state-${state}`}
                      checked={filters.states.includes(state)}
                      onCheckedChange={(checked) => 
                        handleStateChange(state, checked as boolean)
                      }
                    />
                    <Label
                      htmlFor={`state-${state}`}
                      className="text-xs cursor-pointer"
                    >
                      {state}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
