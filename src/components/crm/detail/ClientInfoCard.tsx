import { Mail, Phone, MapPin, User, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTherapistDisplayName, STATUS_CONFIG, ALL_STATUSES, getStatusConfig } from '@/lib/crm/status-config';
import { useUpdateClientStatus } from '@/hooks/crm/useUpdateClientStatus';
import type { CrmClient, PatStatus } from '@/lib/crm/types';
import { format } from 'date-fns';

interface ClientInfoCardProps {
  client: CrmClient;
}

export function ClientInfoCard({ client }: ClientInfoCardProps) {
  const updateStatus = useUpdateClientStatus();

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === client.pat_status) return;
    updateStatus.mutate({
      clientId: client.id,
      newStatus: newStatus as PatStatus,
      oldStatus: client.pat_status,
    });
  };

  // Group statuses by category for the dropdown
  const categories = [
    { key: 'lead', label: 'Leads' },
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'active', label: 'Active' },
    { key: 'inactive', label: 'Inactive' },
    { key: 'closed', label: 'Closed' },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Client Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Selector */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Status</p>
          <Select
            value={client.pat_status || 'New'}
            onValueChange={handleStatusChange}
            disabled={updateStatus.isPending}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map(({ key, label }) => {
                const statuses = ALL_STATUSES.filter(s => STATUS_CONFIG[s].category === key);
                if (statuses.length === 0) return null;
                return (
                  <div key={key}>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {label}
                    </div>
                    {statuses.map(status => {
                      const config = getStatusConfig(status);
                      return (
                        <SelectItem key={status} value={status}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: config.color }}
                            />
                            {config.label}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </div>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {client.email && (
          <div className="flex items-start gap-3">
            <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">Email</p>
              <a 
                href={`mailto:${client.email}`}
                className="text-sm text-muted-foreground hover:text-primary"
              >
                {client.email}
              </a>
            </div>
          </div>
        )}

        {client.phone && (
          <div className="flex items-start gap-3">
            <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">Phone</p>
              <a 
                href={`tel:${client.phone}`}
                className="text-sm text-muted-foreground hover:text-primary"
              >
                {client.phone}
              </a>
            </div>
          </div>
        )}

        {client.pat_state && (
          <div className="flex items-start gap-3">
            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">State</p>
              <p className="text-sm text-muted-foreground">{client.pat_state}</p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-3">
          <User className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-sm font-medium">Primary Therapist</p>
            <p className="text-sm text-muted-foreground">
              {getTherapistDisplayName(client.primary_staff)}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-sm font-medium">Client Since</p>
            <p className="text-sm text-muted-foreground">
              {format(new Date(client.created_at), 'MMMM d, yyyy')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
