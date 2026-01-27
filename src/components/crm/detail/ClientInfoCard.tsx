import { Mail, Phone, MapPin, User, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getTherapistDisplayName } from '@/lib/crm/status-config';
import type { CrmClient } from '@/lib/crm/types';
import { format } from 'date-fns';

interface ClientInfoCardProps {
  client: CrmClient;
}

export function ClientInfoCard({ client }: ClientInfoCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Client Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
