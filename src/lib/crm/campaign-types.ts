import type { EmailContentDocument, EmailEditorDocument } from '@/features/email-studio/contracts';

export type ClientLifecycleStage =
  | 'registration'
  | 'intake'
  | 'matching'
  | 'matched'
  | 'scheduled'
  | 'early_care'
  | 'established_care'
  | 'closed';

export type ClientEngagementState =
  | 'normal'
  | 'unresponsive_warm'
  | 'unresponsive_cold'
  | 'went_dark';

export interface CrmCampaign {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  weekdays_only: boolean;
  send_window_start: string;
  send_window_end: string;
  default_timezone: string;
  on_complete_lifecycle_stage: ClientLifecycleStage | null;
  on_complete_engagement_state: ClientEngagementState | null;
  /** @deprecated Legacy flat-status completion fields retained only for database compatibility. */
  on_complete_action: 'do_nothing' | 'change_status';
  /** @deprecated Legacy flat-status completion field. */
  on_complete_status: string | null;
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
  steps_count?: number;
  active_enrollments_count?: number;
}

export interface CrmCampaignStep {
  id: string;
  campaign_id: string;
  tenant_id: string;
  step_order: number;
  delay_days: number;
  delay_hours: number;
  channel: 'email' | 'sms';
  email_subject: string | null;
  email_body_html: string | null;
  email_body_text: string | null;
  email_preheader: string | null;
  email_content_mode: string | null;
  email_editor_document: EmailEditorDocument | null;
  email_theme_key: string | null;
  email_editor_schema_version: number | null;
  email_render_hash: string | null;
  email_template_version_id: string | null;
  sms_body_text: string | null;
  is_active: boolean;
  signature_id: string | null;
  created_at: string;
  updated_at: string;
}

export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'cancelled' | 'responded';

export interface CrmCampaignEnrollment {
  id: string;
  campaign_id: string;
  tenant_id: string;
  client_id: string;
  current_step: number;
  status: EnrollmentStatus;
  enrolled_at: string;
  enrolled_by_profile_id: string | null;
  paused_at: string | null;
  pause_reason: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  client?: {
    id: string;
    pat_name_f: string | null;
    pat_name_l: string | null;
    pat_name_preferred: string | null;
    email: string | null;
    phone: string | null;
  };
  campaign?: {
    id: string;
    name: string;
  };
}

export type StepLogStatus = 'scheduled' | 'sent' | 'failed' | 'skipped';

export interface CrmCampaignStepLog {
  id: string;
  enrollment_id: string;
  step_id: string;
  tenant_id: string;
  client_id: string;
  scheduled_for: string;
  sent_at: string | null;
  status: StepLogStatus;
  skip_reason: string | null;
  error_message: string | null;
  channel: 'email' | 'sms';
  helpscout_conversation_id: string | null;
  created_at: string;
}

export interface CrmCampaignTrigger {
  id: string;
  campaign_id: string;
  tenant_id: string;
  trigger_on_status: string | null;
  trigger_dimension: string | null;
  trigger_operator: string | null;
  trigger_value: string | null;
  trigger_event: string | null;
  trigger_version: number | null;
  is_manual_only: boolean | null;
  is_active: boolean;
  created_at: string;
}

export interface CampaignFormData {
  name: string;
  description: string;
  is_active: boolean;
  weekdays_only: boolean;
  send_window_start: string;
  send_window_end: string;
  default_timezone: string;
  on_complete_lifecycle_stage: ClientLifecycleStage | null;
  on_complete_engagement_state: ClientEngagementState | null;
}

export interface CampaignStepFormData {
  client_key: string;
  id?: string;
  step_order: number;
  delay_days: number;
  delay_hours: number;
  channel: 'email' | 'sms';
  email_subject: string;
  email_body_html: string;
  email_body_text: string;
  email_preheader: string;
  email_content: EmailContentDocument | null;
  email_template_id: string | null;
  email_template_version_id: string | null;
  sms_body_text: string;
  is_active: boolean;
  signature_id: string | null;
}

export const LIFECYCLE_STAGE_OPTIONS: Array<{ value: ClientLifecycleStage; label: string }> = [
  { value: 'registration', label: 'Registration' },
  { value: 'intake', label: 'Intake' },
  { value: 'matching', label: 'Matching' },
  { value: 'matched', label: 'Matched' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'early_care', label: 'Early Care' },
  { value: 'established_care', label: 'Established Care' },
  { value: 'closed', label: 'Closed' },
];

export const ENGAGEMENT_STATE_OPTIONS: Array<{ value: ClientEngagementState; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'unresponsive_warm', label: 'Unresponsive Warm' },
  { value: 'unresponsive_cold', label: 'Unresponsive Cold' },
  { value: 'went_dark', label: 'Went Dark' },
];

export function lifecycleStageLabel(value: string | null | undefined): string {
  return LIFECYCLE_STAGE_OPTIONS.find((option) => option.value === value)?.label || value || 'Unknown';
}

export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
] as const;

export const PERSONALIZATION_VARIABLES = [
  { key: '{{first_name}}', label: 'Client First Name', example: 'John' },
  { key: '{{preferred_name}}', label: 'Client Preferred Name', example: 'John' },
  { key: '{{last_name}}', label: 'Client Last Name', example: 'Taylor' },
  { key: '{{therapist_name}}', label: 'Therapist Name', example: 'Dr. Smith' },
  { key: '{{sender_name}}', label: 'Sender Name', example: 'ValorWell Care Team' },
] as const;
