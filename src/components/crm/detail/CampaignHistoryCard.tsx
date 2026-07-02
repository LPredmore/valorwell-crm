import { Megaphone } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useClientEnrollmentHistory } from '@/hooks/crm/useCampaignEnrollments';
import type { EnrollmentStatus } from '@/lib/crm/campaign-types';

interface CampaignHistoryCardProps {
  clientId: string;
}

const STATUS_VARIANT: Record<EnrollmentStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  active: 'default',
  paused: 'secondary',
  completed: 'outline',
  cancelled: 'destructive',
  responded: 'outline',
};

export function CampaignHistoryCard({ clientId }: CampaignHistoryCardProps) {
  const { data: enrollments, isLoading } = useClientEnrollmentHistory(clientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="h-4 w-4" />
          Campaign History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !enrollments || enrollments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Never enrolled in a campaign.</p>
        ) : (
          <ul className="space-y-3">
            {enrollments.map((e) => (
              <li
                key={e.id}
                className="flex items-start justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {e.campaign?.name || 'Unknown Campaign'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Enrolled {format(new Date(e.enrolled_at), 'MMM d, yyyy')}
                    {e.completed_at && ` · Ended ${format(new Date(e.completed_at), 'MMM d, yyyy')}`}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[e.status] ?? 'secondary'} className="capitalize shrink-0">
                  {e.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
