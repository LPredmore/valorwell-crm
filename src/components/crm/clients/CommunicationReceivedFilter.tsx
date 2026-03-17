import { MessageSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface CommunicationReceivedFilterProps {
  value?: number;
  onChange: (days: number | undefined) => void;
}

const dayOptions = [1, 2, 3, 4, 5, 6, 7];

export function CommunicationReceivedFilter({ value, onChange }: CommunicationReceivedFilterProps) {
  return (
    <div className="flex items-center gap-1">
      <Select
        value={value?.toString() ?? ''}
        onValueChange={(v) => onChange(v ? Number(v) : undefined)}
      >
        <SelectTrigger className="h-9 w-auto gap-2 border-dashed text-sm">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <SelectValue placeholder="Comm. Received" />
          {value && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
              {value}d
            </Badge>
          )}
        </SelectTrigger>
        <SelectContent>
          {dayOptions.map((d) => (
            <SelectItem key={d} value={d.toString()}>
              Last {d} {d === 1 ? 'day' : 'days'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onChange(undefined)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
