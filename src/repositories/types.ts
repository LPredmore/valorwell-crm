import type {
  CanonicalClient,
  LifecycleStage,
  EngagementState,
  EligibilityState,
  ContactPolicy,
  ServicePolicy,
  CareCadence,
  RiskState,
  ClosureInfo,
} from '@/domain/canonical';
import type { TaskView, TaskViewDateBounds } from '@/domain/taskViews';
import type {
  CrmTask,
  TaskStatus,
  OperationalException,
  ExceptionStatus,
  Campaign,
  CampaignEnrollment,
  CommunicationMessage,
  StaffMember,
  AuditEvent,
  CommunicationPolicyResult,
} from '@/domain/operations';
import type { EmailContentDocument } from '@/features/email-studio/contracts';
import type { Tables } from '@/integrations/supabase/types';
import type { RelationshipsRepository } from './relationships';

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListClientsQuery {
  search?: string;
  lifecycle?: LifecycleStage[];
  engagement?: EngagementState[];
  eligibility?: EligibilityState[];
  contactPolicy?: ContactPolicy[];
  servicePolicy?: ServicePolicy[];
  atRisk?: boolean;
  assignedClinicianIds?: string[];
  states?: string[];
  page?: number;
  pageSize?: number;
  sortBy?: keyof CanonicalClient;
  sortDir?: 'asc' | 'desc';
}

export interface ClientsRepository {
  list(tenantId: string, query: ListClientsQuery): Promise<Paged<CanonicalClient>>;
  get(tenantId: string, id: string): Promise<CanonicalClient | null>;
  updateLifecycle(tenantId: string, id: string, next: LifecycleStage, reason: string, note?: string): Promise<CanonicalClient>;
  updateEngagement(tenantId: string, id: string, next: EngagementState): Promise<CanonicalClient>;
  updateEligibility(
    tenantId: string,
    id: string,
    next: EligibilityState,
    note?: string,
    manualReview?: { owner: string; next_action: string; review_due_at: string } | null,
  ): Promise<CanonicalClient>;
  updateContactPolicy(tenantId: string, id: string, next: ContactPolicy, reason: string): Promise<CanonicalClient>;
  updateServicePolicy(tenantId: string, id: string, next: ServicePolicy, reason: string): Promise<CanonicalClient>;
  updateCareCadence(tenantId: string, id: string, next: CareCadence): Promise<CanonicalClient>;
  updateRisk(tenantId: string, id: string, next: RiskState): Promise<CanonicalClient>;
  close(tenantId: string, id: string, info: ClosureInfo): Promise<CanonicalClient>;
  reopen(tenantId: string, id: string, reason: string): Promise<CanonicalClient>;
  assignClinician(tenantId: string, id: string, staffId: string, reason?: string): Promise<CanonicalClient>;
  assignOperationsOwner(tenantId: string, id: string, staffId: string | null): Promise<CanonicalClient>;
}

export interface ListTasksQuery {
  /** Current CRM operating tenant. Required for every named Canonical Tasks view. */
  tenantId?: string;
  /** Authenticated operator profile ID. Required by the My Tasks view. */
  currentProfileId?: string;
  /** Operator-local day/week boundaries, already converted to UTC ISO instants. */
  dateBounds?: TaskViewDateBounds;
  /** Deterministic clock override for overdue queries/tests. Defaults to current time. */
  nowIso?: string;
  ownerIds?: string[];
  clientId?: string;
  statuses?: TaskStatus[];
  dueBefore?: string;
  dueAfter?: string;
  types?: string[];
  search?: string;
  view?: TaskView;
}

export interface TasksRepository {
  list(query: ListTasksQuery): Promise<CrmTask[]>;
  get(tenantId: string, id: string): Promise<CrmTask | null>;
  create(tenantId: string, input: Omit<CrmTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<CrmTask>;
  update(tenantId: string, id: string, patch: Partial<CrmTask>): Promise<CrmTask>;
  complete(tenantId: string, id: string, note?: string): Promise<CrmTask>;
  reassign(tenantId: string, ids: string[], ownerId: string): Promise<void>;
  bulkStatus(tenantId: string, ids: string[], status: TaskStatus): Promise<void>;
  bulkDueDate(tenantId: string, ids: string[], dueAt: string): Promise<void>;
}

export interface ExceptionsRepository {
  list(tenantId: string, query?: { status?: ExceptionStatus[]; ownerId?: string; clientId?: string }): Promise<OperationalException[]>;
  get(tenantId: string, id: string): Promise<OperationalException | null>;
  resolve(tenantId: string, id: string, note?: string): Promise<OperationalException>;
  dismiss(tenantId: string, id: string, note?: string): Promise<OperationalException>;
  reassign(tenantId: string, id: string, ownerId: string): Promise<OperationalException>;
  createTaskFromException(tenantId: string, id: string): Promise<CrmTask>;
}

export interface CampaignsRepository {
  list(tenantId: string): Promise<Campaign[]>;
  get(tenantId: string, id: string): Promise<Campaign | null>;
  create(tenantId: string, input: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'metrics'>): Promise<Campaign>;
  update(tenantId: string, id: string, patch: Partial<Campaign>): Promise<Campaign>;
  enrollments(tenantId: string, campaignId: string): Promise<CampaignEnrollment[]>;
  enroll(tenantId: string, campaignId: string, clientIds: string[]): Promise<CampaignEnrollment[]>;
  pauseEnrollment(tenantId: string, enrollmentId: string, reason: string): Promise<CampaignEnrollment>;
  resumeEnrollment(tenantId: string, enrollmentId: string, reason: string): Promise<CampaignEnrollment>;
  cancelEnrollment(tenantId: string, enrollmentId: string, reason: string): Promise<CampaignEnrollment>;
  restartEnrollment(tenantId: string, enrollmentId: string, reason: string): Promise<CampaignEnrollment>;
}

export type CommunicationSendInput = Omit<CommunicationMessage, 'id' | 'createdAt' | 'status'> & {
  /** Canonical Email Studio snapshot. Required by the manual Direct-email path. */
  emailContent?: EmailContentDocument;
  /** Immutable version attribution. Cleared as soon as version content is edited. */
  emailTemplateVersionId?: string | null;
  /** Canonical message UUID for provider-level reply headers. */
  inReplyToMessageId?: string | null;
  /** Stable workflow identifier written to the provider ledger and audit metadata. */
  source?: string;
};

export interface CommunicationsRepository {
  listForClient(tenantId: string, clientId: string): Promise<CommunicationMessage[]>;
  listThreads(tenantId: string, channel: 'sms' | 'email'): Promise<CommunicationMessage[]>;
  send(tenantId: string, message: CommunicationSendInput): Promise<CommunicationMessage>;
  evaluatePolicy(tenantId: string, input: {
    clientId: string;
    channel: 'sms' | 'email';
    campaignId?: string;
    messageClass: import('@/domain/operations').CanonicalMessageClass;
  }): Promise<CommunicationPolicyResult>;
  ingestInbound(tenantId: string, message: Omit<CommunicationMessage, 'id' | 'createdAt' | 'status'>): Promise<CommunicationMessage>;
}

export interface StaffRepository {
  list(tenantId: string): Promise<StaffMember[]>;
  get(tenantId: string, id: string): Promise<StaffMember | null>;
}

export interface AuditRepository {
  listForClient(tenantId: string, clientId: string): Promise<AuditEvent[]>;
}

export interface ReportBucket<Row> {
  tenantId: string;
  bucketStart: string;
  bucketEnd: string | null;
  rows: Row[];
}

type WithSafeReportNumbers<Row, Keys extends keyof Row> = Omit<Row, Keys> & {
  [Key in Keys]-?: Exclude<Row[Key], null>;
};

export type FunnelReportRow = WithSafeReportNumbers<
  Tables<'v_crm_reports_funnel'>,
  'entered_count' | 'exited_count' | 'current_count' | 'median_days_in_stage'
>;

export type EngagementReportRow = WithSafeReportNumbers<
  Tables<'v_crm_reports_engagement'>,
  'current_count' | 'entered_count'
>;

export type ClosureReportRow = WithSafeReportNumbers<
  Tables<'v_crm_reports_closure'>,
  'closed_count' | 'reopened_count' | 'net_closed'
>;

export type CampaignReportRow = WithSafeReportNumbers<
  Tables<'v_crm_reports_campaigns'>,
  | 'enrolled_count'
  | 'completed_count'
  | 'cancelled_count'
  | 'responded_count'
  | 'suppressed_count'
  | 'failed_count'
> & {
  campaignName: string;
};

export type TaskReportRow = WithSafeReportNumbers<
  Tables<'v_crm_reports_tasks'>,
  'open_count' | 'completed_count' | 'overdue_count' | 'median_hours_to_complete'
> & {
  assigneeName: string;
};

export type ExceptionReportRow = WithSafeReportNumbers<
  Tables<'v_crm_reports_exceptions'>,
  'raised_count' | 'resolved_count' | 'open_count' | 'median_hours_to_resolve'
>;

export interface ReportsRepository {
  journeyFunnel(tenantId: string): Promise<ReportBucket<FunnelReportRow> | null>;
  engagementMetrics(tenantId: string): Promise<ReportBucket<EngagementReportRow> | null>;
  closureMetrics(tenantId: string): Promise<ReportBucket<ClosureReportRow> | null>;
  campaignPerformance(tenantId: string): Promise<ReportBucket<CampaignReportRow> | null>;
  taskPerformance(tenantId: string): Promise<ReportBucket<TaskReportRow> | null>;
  exceptionMetrics(tenantId: string): Promise<ReportBucket<ExceptionReportRow> | null>;
}

export interface CrmDataProvider {
  clients: ClientsRepository;
  tasks: TasksRepository;
  exceptions: ExceptionsRepository;
  campaigns: CampaignsRepository;
  communications: CommunicationsRepository;
  staff: StaffRepository;
  audit: AuditRepository;
  reports: ReportsRepository;
  /** Never aliases clients, clinical campaigns, or clinical communications. */
  relationships: RelationshipsRepository;
}
