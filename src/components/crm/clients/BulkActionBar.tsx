import { Mail, MessageSquare, Megaphone, ArrowRightLeft, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusBadge } from './StatusBadge';
import { ALL_STATUSES } from '@/lib/crm/status-config';
import { useTagOptions } from '@/hooks/crm/useTagOptions';
import type { PatStatus } from '@/lib/crm/types';

interface BulkActionBarProps {
  selectedCount: number;
  onSendEmail: () => void;
  onSendSms?: () => void;
  onEnrollCampaign?: () => void;
  onChangeStatus?: (newStatus: PatStatus) => void;
  onSetTag?: (tag: string | null) => void;
  onClear: () => void;
  entityLabel?: 'client' | 'staff';
}

export function BulkActionBar({ 
  selectedCount, 
  onSendEmail, 
  onSendSms, 
  onEnrollCampaign,
  onChangeStatus,
  onSetTag,
  onClear, 
  entityLabel = 'client' 
}: BulkActionBarProps) {
  const { data: tagOptions = [] } = useTagOptions();
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
          {onChangeStatus && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary" className="gap-2">
                  <ArrowRightLeft className="h-4 w-4" />
                  Change Status
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="max-h-72 overflow-y-auto">
                {ALL_STATUSES.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    onClick={() => onChangeStatus(status)}
                  >
                    <StatusBadge status={status} size="sm" />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {onSetTag && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary" className="gap-2">
                  <Tag className="h-4 w-4" />
                  Set Tag
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="max-h-72 overflow-y-auto">
                {tagOptions.map((tag) => (
                  <DropdownMenuItem
                    key={tag}
                    onClick={() => onSetTag(tag)}
                  >
                    {tag}
                  </DropdownMenuItem>
                ))}
                {tagOptions.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => onSetTag(null)} className="text-destructive">
                  Remove Tag
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
