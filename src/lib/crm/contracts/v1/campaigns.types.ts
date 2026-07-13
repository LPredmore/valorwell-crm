// Canonical campaign definition template — §13.2

import type { CanonicalEventType } from './events.types';

export type MessageClass =
  | 'ordinary_promotional'
  | 'ordinary_campaign_follow_up'
  | 'wait_path_ordinary'
  | 'necessary_scheduling'
  | 'active_care'
  | 'billing_insurance'
  | 'clinical_safety_legal'
  | 'transactional_account';

export const SUPPRESSABLE_CLASSES: ReadonlySet<MessageClass> = new Set([
  'ordinary_promotional',
  'ordinary_campaign_follow_up',
  'wait_path_ordinary',
]);

export interface CanonicalCampaignDefinition {
  key: string;
  contract_version: string;
  family:
    | 'lead'
    | 'registration'
    | 'intake'
    | 'matching'
    | 'scheduling'
    | 'waitlist'
    | 'at_risk'
    | 'engagement_recovery'
    | 'follow_up';
  entry_event: CanonicalEventType;
  cancellation_events: CanonicalEventType[];
  message_class: MessageClass;
  excludes_as_needed: boolean;
  steps: CampaignStepSpec[];
}

export interface CampaignStepSpec {
  order: number;
  channel: 'email' | 'sms';
  delay_hours: number;
  template_key: string;
  requires_recheck: true;
}
