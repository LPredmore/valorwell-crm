import { supabase } from '@/integrations/supabase/client';
import type { AuditRepository } from '../types';
import type { AuditEvent } from '@/domain/operations';

type Row = Record<string, string | number | null>;

function eventTypeFor(dimension: string): string {
  switch (dimension) {
    case 'lifecycle_stage': return 'Lifecycle changed';
    case 'engagement_state': return 'Engagement changed';
    case 'eligibility_state': return 'Eligibility changed';
    case 'contact_policy': return 'Contact policy changed';
    case 'service_policy': return 'Service policy changed';
    case 'care_cadence': return 'Care cadence changed';
    case 'closure_reason': return 'Client closed';
    case 'assignment_clinician': return 'Clinician assigned';
    case 'risk_state': return 'Risk state changed';
    default: return dimension;
  }
}

function rowToEvent(r: Row): AuditEvent {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    clientId: r.client_id,
    eventType: eventTypeFor(r.dimension),
    previousValue: r.from_value ?? null,
    newValue: r.to_value ?? null,
    actor: {
      profileId: r.actor_profile_id ?? undefined,
      label: r.actor_label ?? (r.actor_profile_id ? 'User' : 'System'),
      automated: !r.actor_profile_id,
    },
    source: r.source ?? 'system',
    reason: r.reason ?? r.disposition_reason ?? undefined,
    correlationId: r.correlation_id ?? undefined,
    createdAt: r.created_at,
  };
}

export const supabaseAuditRepository: AuditRepository = {
  async listForClient(clientId) {
    const { data, error } = await supabase
      .from('crm_client_state_audit')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToEvent);
  },
};
