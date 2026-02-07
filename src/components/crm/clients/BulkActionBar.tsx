import { Mail, MessageSquare, Megaphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BulkActionBarProps {
  selectedCount: number;
  onSendEmail: () => void;
  onSendSms?: () => void;
  onEnrollCampaign?: () => void;
  onClear: () => void;
  entityLabel?: 'client' | 'staff';
}

export function BulkActionBar({ 
  selectedCount, 
  onSendEmail, 
  onSendSms, 
  onEnrollCampaign,
  onClear, 
  entityLabel = 'client' 
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  const label = entityLabel === 'staff' 
    ? `${selectedCount} staff member${selectedCount !== 1 ? 's' : ''}`
    : `${selectedCount} client${selectedCount !== 1 ? 's' : ''}`;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3 shadow-lg">
        <span className="text-sm font-medium">
          {label} selected
        </span>
        <div className="flex items-center gap-2">
          <Button onClick={onSendEmail} size="sm" className="gap-2">
            <Mail className="h-4 w-4" />
            Send Email
          </Button>
          {onSendSms && (
            <Button onClick={onSendSms} size="sm" variant="secondary" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Send Text
            </Button>
          )}
          {onEnrollCampaign && (
            <Button onClick={onEnrollCampaign} size="sm" variant="secondary" className="gap-2">
              <Megaphone className="h-4 w-4" />
              Enroll in Campaign
            </Button>
          )}
          <Button onClick={onClear} variant="ghost" size="sm" className="gap-2">
            <X className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
