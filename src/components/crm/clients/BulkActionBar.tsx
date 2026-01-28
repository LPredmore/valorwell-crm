import { Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BulkActionBarProps {
  selectedCount: number;
  onSendEmail: () => void;
  onClear: () => void;
}

export function BulkActionBar({ selectedCount, onSendEmail, onClear }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3 shadow-lg">
        <span className="text-sm font-medium">
          {selectedCount} client{selectedCount !== 1 ? 's' : ''} selected
        </span>
        <div className="flex items-center gap-2">
          <Button onClick={onSendEmail} size="sm" className="gap-2">
            <Mail className="h-4 w-4" />
            Send Email
          </Button>
          <Button onClick={onClear} variant="ghost" size="sm" className="gap-2">
            <X className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
