import { cn } from '@/lib/utils';
import { getStatusConfig } from '@/lib/crm/status-config';
import type { PatStatus } from '@/lib/crm/types';

interface StatusBadgeProps {
  status: PatStatus | null;
  className?: string;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, className, size = 'md' }: StatusBadgeProps) {
  const config = getStatusConfig(status);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium",
        config.bgColor,
        config.textColor,
        size === 'sm' ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        className
      )}
    >
      {config.label}
    </span>
  );
}
