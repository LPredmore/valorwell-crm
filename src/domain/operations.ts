import type { LifecycleStage, EngagementState, EligibilityState, RiskSeverity } from './canonical';

export type TaskStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Waiting'
  | 'Blocked'
  | 'Completed'
  | 'Canceled';

export const TASK_STATUSES: TaskStatus[] = [
  'Not Started',
  'In Progress',
  'Waiting',
  'Blocked',
  'Completed',
  'Canceled',
];

export type TaskPriority = 'Low' | 'Normal' | 'High' | 'Urgent';

export type TaskType =
  | 'Client Follow-Up'
  | 'Staff Follow-Up'
  | 'Campaign Exception'
  | 'Eligibility Review'
  | 'Match Review'
  | 'Documentation'
  | 'Risk Intervention'
  | 'General';

export interface CrmTask {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  clientId?: string;
  staffId?: string;
  campaignId?: string;
  exceptionId?: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  ownerId?: string;
  collaboratorIds: string[];
  createdByProfileId: string;
  startAt?: string;
  dueAt?: string;
  completedAt?: string;
  recurrence?: 'None' | 'Daily' | 'Weekly' | 'Monthly';
  checklist: { id: string; label: string; done: boolean }[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type ExceptionType =
  | 'Campaign Message Failed'
  | 'Campaign Step Overdue'
  | 'Client Reply Needs Review'
  | 'Client Went Dark'
  | 'Client Became At Risk'
  | 'Missed Appointment Follow-Up'
  | 'Eligibility Verification Failed'
  | 'No Clinician Match Found'
  | 'Communication Suppressed'
  | 'Assignment Missing'
  | 'Data Conflict'
  | 'Integration Failure'
  | 'Manual Review Required';

export type ExceptionSeverity = 'Low' | 'Medium' | 'High' | 'Critical';
export type ExceptionStatus = 'Open' | 'In Review' | 'Resolved' | 'Dismissed';

export interface OperationalException {
  id: string;
  tenantId: string;
  type: ExceptionType;
  severity: ExceptionSeverity;
  status: ExceptionStatus;
  clientId?: string;
  campaignId?: string;
  workflow?: string;
  ownerId?: string;
  createdAt: string;
  dueAt?: string;
  lastActivityAt: string;
  summary: string;
  recommendedResolution?: string;
  resolutionHistory: {
    at: string;
    byProfileId?: string;
    action: string;
    note?: string;
  }[];
}

/**
 * Canonical message-class vocabulary — MUST mirror the backend enum used by
 * `crm_evaluate_communication_policy` and the suppression edge helper.
 */
export type CanonicalMessageClass =
  | 'ordinary_promotional'
  | 'ordinary_campaign_follow_up'
  | 'wait_path_ordinary'
  | 'necessary_scheduling'
  | 'active_care'
  | 'billing_insurance'
  | 'clinical_safety_legal'
  | 'transactional_account';

export interface CommunicationPolicyResult {
  allowed: boolean;
  requiresReview: boolean;
  reasons: string[];
  /** Backend reason code (see REASON_COPY in PolicyAwareComposer) or a legacy code. */
  suppressionCode?: string;
}

export type CampaignStatus = 'Draft' | 'Active' | 'Paused' | 'Archived';

export type CampaignStepType =
  | 'SMS'
  | 'Email'
  | 'Internal Task'
  | 'Wait'
  | 'Condition'
  | 'Manual Review'
  | 'Lifecycle Update'
  | 'Engagement Update'
  | 'Assignment Action';

export interface CampaignStep {
  id: string;
  order: number;
  type: CampaignStepType;
  label: string;
  delayHours?: number;
  templateId?: string;
  body?: string;
  subject?: string;
  sendWindow?: { startHour: number; endHour: number };
  timezone?: string;
  stopOnReply?: boolean;
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  purpose?: string;
  status: CampaignStatus;
  ownerId?: string;
  audienceSummary: string;
  entryConditions: string[];
  exitConditions: string[];
  reenrollmentAllowed: boolean;
  suppressableClass:
    | 'ordinary_campaign_follow_up'
    | 'critical_operational'
    | 'transactional';
  steps: CampaignStep[];
  metrics: {
    enrolled: number;
    active: number;
    completed: number;
    responseRate: number;
    suppressed: number;
    failed: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CampaignEnrollment {
  id: string;
  campaignId: string;
  clientId: string;
  status: 'Active' | 'Paused' | 'Completed' | 'Canceled' | 'Failed';
  currentStepId?: string;
  startedAt: string;
  nextActionAt?: string;
  completedSteps: string[];
  exitReason?: string;
}

export interface CommunicationMessage {
  id: string;
  tenantId: string;
  clientId?: string;
  channel: 'sms' | 'email' | 'phone' | 'note';
  direction: 'inbound' | 'outbound';
  from: string;
  to: string;
  subject?: string;
  body: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed' | 'received';
  suppressionReason?: string;
  campaignId?: string;
  messageClass?: CanonicalMessageClass;
  threadId: string;
  createdAt: string;
}

export interface StaffMember {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  role: 'admin' | 'clinician' | 'operations' | 'staff';
  status: 'Active' | 'On Leave' | 'Inactive';
  states: string[];
  email: string;
  phone?: string;
  caseloadCount: number;
  openTaskCount: number;
  availability: 'Available' | 'Full' | 'Unavailable';
  credentialsSummary?: string;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  clientId?: string;
  /** Stable machine identifier (matches crm_client_state_audit.dimension). */
  eventType: string;
  /** Human-readable label derived from eventType — safe to change without breaking filters. */
  eventLabel: string;
  previousValue?: string | null;
  newValue?: string | null;
  actor: { profileId?: string; label: string; automated: boolean };
  source: string;
  reason?: string;
  correlationId?: string;
  createdAt: string;
}

export type { LifecycleStage, EngagementState, EligibilityState, RiskSeverity };
