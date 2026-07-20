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
  list(query: ListClientsQuery): Promise<Paged<CanonicalClient>>;
  get(id: string): Promise<CanonicalClient | null>;
  updateLifecycle(id: string, next: LifecycleStage, reason: string, note?: string): Promise<CanonicalClient>;
  updateEngagement(id: string, next: EngagementState): Promise<CanonicalClient>;
  updateEligibility(
    id: string,
    next: EligibilityState,
    note?: string,
    manualReview?: { owner: string; next_action: string; review_due_at: string } | null,
  ): Promise<CanonicalClient>;
  updateContactPolicy(id: string, next: ContactPolicy, reason: string): Promise<CanonicalClient>;
  updateServicePolicy(id: string, next: ServicePolicy, reason: string): Promise<CanonicalClient>;
  updateCareCadence(id: string, next: CareCadence): Promise<CanonicalClient>;
  updateRisk(id: string, next: RiskState): Promise<CanonicalClient>;
  close(id: string, info: ClosureInfo): Promise<CanonicalClient>;
  reopen(id: string, reason: string): Promise<CanonicalClient>;
  assignClinician(id: string, staffId: string, reason?: string): Promise<CanonicalClient>;
  assignOperationsOwner(id: string, staffId: string | null): Promise<CanonicalClient>;
}

export interface ListTasksQuery {
  ownerIds?: string[];
  clientId?: string;
  statuses?: TaskStatus[];
  dueBefore?: string;
  dueAfter?: string;
  types?: string[];
  search?: string;
  view?:
    | 'my'
    | 'team'
    | 'overdue'
    | 'due-today'
    | 'due-week'
    | 'unassigned'
    | 'client-followups'
    | 'staff-followups'
    | 'campaign-exceptions'
    | 'recently-completed'
    | 'all';
}

export interface TasksRepository {
  list(query: ListTasksQuery): Promise<CrmTask[]>;
  get(id: string): Promise<CrmTask | null>;
  create(input: Omit<CrmTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<CrmTask>;
  update(id: string, patch: Partial<CrmTask>): Promise<CrmTask>;
  complete(id: string, note?: string): Promise<CrmTask>;
  reassign(ids: string[], ownerId: string): Promise<void>;
  bulkStatus(ids: string[], status: TaskStatus): Promise<void>;
  bulkDueDate(ids: string[], dueAt: string): Promise<void>;
}

export interface ExceptionsRepository {
  list(query?: { status?: ExceptionStatus[]; ownerId?: string; clientId?: string }): Promise<OperationalException[]>;
  get(id: string): Promise<OperationalException | null>;
  resolve(id: string, note?: string): Promise<OperationalException>;
  dismiss(id: string, note?: string): Promise<OperationalException>;
  reassign(id: string, ownerId: string): Promise<OperationalException>;
  createTaskFromException(id: string): Promise<CrmTask>;
}

export interface CampaignsRepository {
  list(): Promise<Campaign[]>;
  get(id: string): Promise<Campaign | null>;
  create(input: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'metrics'>): Promise<Campaign>;
  update(id: string, patch: Partial<Campaign>): Promise<Campaign>;
  enrollments(campaignId: string): Promise<CampaignEnrollment[]>;
  enroll(campaignId: string, clientIds: string[]): Promise<CampaignEnrollment[]>;
  pauseEnrollment(enrollmentId: string, reason: string): Promise<CampaignEnrollment>;
  resumeEnrollment(enrollmentId: string, reason: string): Promise<CampaignEnrollment>;
  cancelEnrollment(enrollmentId: string, reason: string): Promise<CampaignEnrollment>;
  restartEnrollment(enrollmentId: string, reason: string): Promise<CampaignEnrollment>;
}

export interface CommunicationsRepository {
  listForClient(clientId: string): Promise<CommunicationMessage[]>;
  listThreads(channel: 'sms' | 'email'): Promise<CommunicationMessage[]>;
  send(message: Omit<CommunicationMessage, 'id' | 'createdAt' | 'status'>): Promise<CommunicationMessage>;
  evaluatePolicy(input: {
    clientId: string;
    channel: 'sms' | 'email';
    campaignId?: string;
    messageClass: import('@/domain/operations').CanonicalMessageClass;
  }): Promise<CommunicationPolicyResult>;
  ingestInbound(message: Omit<CommunicationMessage, 'id' | 'createdAt' | 'status'>): Promise<CommunicationMessage>;
}

export interface StaffRepository {
  list(): Promise<StaffMember[]>;
  get(id: string): Promise<StaffMember | null>;
}

export interface AuditRepository {
  listForClient(clientId: string): Promise<AuditEvent[]>;
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
>;

export type TaskReportRow = WithSafeReportNumbers<
  Tables<'v_crm_reports_tasks'>,
  'open_count' | 'completed_count' | 'overdue_count' | 'median_hours_to_complete'
>;

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
