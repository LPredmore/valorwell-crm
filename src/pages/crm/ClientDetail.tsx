import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, MapPin, User } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/crm/clients/StatusBadge';
import { LifecycleBadge, EngagementBadge, AtRiskBadge, DncBadge } from '@/components/crm/clients/CanonicalBadges';
import { useCanonicalClientState } from '@/hooks/crm/useCanonicalClientState';
import { ActivityTimeline } from '@/components/crm/detail/ActivityTimeline';
import { NoteForm } from '@/components/crm/detail/NoteForm';
import { ClientInfoCard } from '@/components/crm/detail/ClientInfoCard';
import { CampaignHistoryCard } from '@/components/crm/detail/CampaignHistoryCard';
import { ClientJourneyExceptionSummary } from '@/components/crm/detail/ClientJourneyExceptionSummary';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { getClientDisplayName, getTherapistDisplayName } from '@/lib/crm/status-config';
import type { CrmClient, PatStatus } from '@/lib/crm/types';

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenantId, isAuthenticated } = useCrmAuth();
  const { data: canonicalResult } = useCanonicalClientState(id);
  const canonical = canonicalResult?.status === 'ok' ? canonicalResult.data : null;


  const { data: client, isLoading } = useQuery({
    queryKey: ['crm-client', id],
    queryFn: async (): Promise<CrmClient | null> => {
      if (!id) return null;

      const { data, error } = await supabase
        .from('clients')
        .select(`
          id,
          tenant_id,
          pat_name_f,
          pat_name_m,
          pat_name_l,
          pat_name_preferred,
          email,
          phone,
          pat_state,
          pat_status,
          tags,
          created_at,
          updated_at,
          last_contact_at,
          last_contact_direction,
          last_contact_channel,
          clickup_synced_at,
          primary_staff:staff!clients_primary_staff_id_fkey (
            id,
            prov_name_f,
            prov_name_l,
            prov_name_for_clients
          )
        `)
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        ...data,
        pat_status: data.pat_status as PatStatus | null,
        last_contact_direction: data.last_contact_direction as 'sent' | 'received' | null,
        last_contact_channel: data.last_contact_channel as 'email' | 'sms' | null,
        primary_staff: Array.isArray(data.primary_staff)
          ? data.primary_staff[0] || null
          : data.primary_staff,
      };
    },
    enabled: isAuthenticated && !!tenantId && !!id,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-96 lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Client not found</p>
        <Button onClick={() => navigate('/crm/clients')}>
          Back to Clients
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/crm/clients')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              {getClientDisplayName(client)}
            </h1>
            {canonical ? (
              <>
                <LifecycleBadge stage={canonical.lifecycle} />
                <EngagementBadge state={canonical.engagement} />
                <AtRiskBadge atRisk={canonical.at_risk?.at_risk} />
                <DncBadge policy={canonical.contact_policy} />
              </>
            ) : (
              <StatusBadge status={client.pat_status} />
            )}
          </div>
          {client.pat_name_preferred && (
            <p className="text-sm text-muted-foreground">
              Legal name: {client.pat_name_f} {client.pat_name_l}
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Client Info */}
        <div className="space-y-6">
          <ClientInfoCard client={client} />
          <ClientJourneyExceptionSummary clientId={client.id} tenantId={client.tenant_id} />
          <CampaignHistoryCard clientId={client.id} />
        </div>

        {/* Right: Activity Timeline */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Add Note</CardTitle>
            </CardHeader>
            <CardContent>
              <NoteForm clientId={client.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline clientId={client.id} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
