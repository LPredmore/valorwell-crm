// Campaign System TypeScript interfaces

export interface CrmCampaign {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  weekdays_only: boolean;
  send_window_start: string; // time format HH:MM:SS
  send_window_end: string;
  default_timezone: string;
  on_complete_action: 'do_nothing' | 'change_status';
  on_complete_status: string | null;
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
  // Computed fields from joins
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
  sms_body_text: string | null;
  is_active: boolean;
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
  // Joined fields
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

// Form types for creating/editing
export interface CampaignFormData {
  name: string;
  description: string;
  is_active: boolean;
  weekdays_only: boolean;
  send_window_start: string;
  send_window_end: string;
  default_timezone: string;
  on_complete_action: 'do_nothing' | 'change_status';
  on_complete_status: string | null;
}

export interface CampaignStepFormData {
  id?: string; // For existing steps
  step_order: number;
  delay_days: number;
  delay_hours: number;
  channel: 'email' | 'sms';
  email_subject: string;
  email_body_html: string;
  sms_body_text: string;
  is_active: boolean;
}

// Common US timezones for the dropdown
export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
] as const;

// Completion action options
export const COMPLETION_ACTION_OPTIONS = [
  { value: 'do_nothing', label: 'Do Nothing' },
  { value: 'change_status', label: 'Change Client Status' },
] as const;

// Personalization variables available in templates
export const PERSONALIZATION_VARIABLES = [
  { key: '{{first_name}}', label: 'Client First Name', example: 'John' },
  { key: '{{therapist_name}}', label: 'Therapist Name', example: 'Dr. Smith' },
] as const;
