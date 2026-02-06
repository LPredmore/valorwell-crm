import { cn } from '@/lib/utils';
import { STAFF_STATUS_CONFIG, type StaffStatus } from '@/lib/crm/staff-types';

interface StaffStatusBadgeProps {
  status: StaffStatus | null;
  className?: string;
}

export function StaffStatusBadge({ status, className }: StaffStatusBadgeProps) {
  const config = status ? STAFF_STATUS_CONFIG[status] : null;

  if (!config) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
          'bg-gray-100 text-gray-500 dark:bg-gray-800/50 dark:text-gray-400',
          className
        )}
      >
        Unknown
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.bgColor,
        config.textColor,
        className
      )}
    >
      {config.label}
    </span>
  );
}
