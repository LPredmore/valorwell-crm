// Canonical event envelope + catalog — v1
// Consumed by campaign scheduler + activity timeline. Never fabricated in CRM.

export type CanonicalEventType =
  | 'lead.created'
  | 'lead.updated'
  | 'registration.started'
  | 'registration.completed'
  | 'intake.started'
  | 'intake.completed'
  | 'eligibility.changed'
  | 'contact_policy.changed'
  | 'service_policy.changed'
  | 'lifecycle.changed'
  | 'engagement.changed'
  | 'at_risk.changed'
  | 'care_cadence.changed'
  | 'disposition.changed'
  | 'provider_demand.opened'
  | 'provider_demand.changed'
  | 'provider_demand.resolved'
  | 'matchable_options.available'
  | 'therapist.selected'
  | 'appointment.created'
  | 'appointment.changed'
  | 'appointment.cancelled'
  | 'client.response_received'
  | 'client.remove_received'
  | 'exception.opened'
  | 'exception.changed'
  | 'exception.resolved'
  | 'clickup.mirror_requested'
  | 'clickup.mirror_completed'
  | 'clickup.mirror_failed';

export interface CanonicalEvent<TPayload = Record<string, unknown>> {
  tenant_id: string;
  event_id: string;
  idempotency_key: string;
  aggregate_type: 'client' | 'appointment' | 'campaign_enrollment' | 'exception';
  aggregate_id: string;
  event_type: CanonicalEventType;
  event_version: string;
  occurred_at: string;
  source: string;
  actor: { type: 'system' | 'user' | 'service'; id: string | null };
  reason_context: string | null;
  payload: TPayload;
  delivery_state: 'pending' | 'processing' | 'delivered' | 'retrying' | 'dead_lettered' | 'replayed';
  attempt_count: number;
  next_retry_at: string | null;
  delivered_at: string | null;
  dead_lettered_at: string | null;
  error_summary: string | null;
  correlation_id: string | null;
}
