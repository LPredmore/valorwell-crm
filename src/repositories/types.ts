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
  assignedOperationsOwnerIds?: string[];
  states?: string[];
  payers?: string[];
  campaignIds?: string[];
  tags?: string[];
  hasOpenTasks?: boolean;
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
  updateEligibility(id: string, next: EligibilityState, note?: string): Promise<CanonicalClient>;
  updateContactPolicy(id: string, next: ContactPolicy, reason: string): Promise<CanonicalClient>;
  updateServicePolicy(id: string, next: ServicePolicy, reason: string): Promise<CanonicalClient>;
  updateCareCadence(id: string, next: CareCadence): Promise<CanonicalClient>;
  updateRisk(id: string, next: RiskState): Promise<CanonicalClient>;
  close(id: string, info: ClosureInfo): Promise<CanonicalClient>;
  reopen(id: string, reason: string): Promise<CanonicalClient>;
  assignClinician(id: string, staffId: string): Promise<CanonicalClient>;
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
  pauseEnrollment(enrollmentId: string): Promise<CampaignEnrollment>;
  resumeEnrollment(enrollmentId: string): Promise<CampaignEnrollment>;
  cancelEnrollment(enrollmentId: string, reason: string): Promise<CampaignEnrollment>;
  restartEnrollment(enrollmentId: string): Promise<CampaignEnrollment>;
}

export interface CommunicationsRepository {
  listForClient(clientId: string): Promise<CommunicationMessage[]>;
  listThreads(channel: 'sms' | 'email'): Promise<CommunicationMessage[]>;
  send(message: Omit<CommunicationMessage, 'id' | 'createdAt' | 'status'>): Promise<CommunicationMessage>;
  evaluatePolicy(input: {
    clientId: string;
    channel: 'sms' | 'email';
    campaignId?: string;
    messageClass: 'ordinary_campaign_follow_up' | 'critical_operational' | 'transactional' | 'manual';
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

export interface ReportsRepository {
  journeyFunnel(): Promise<{ stage: LifecycleStage; count: number; medianDays: number }[]>;
  atRiskMetrics(): Promise<{
    totalAtRisk: number;
    newlyAtRisk: number;
    resolved: number;
    averageDaysAtRisk: number;
    byReason: { reason: string; count: number }[];
    byStage: { stage: LifecycleStage; count: number }[];
    overdueInterventions: number;
  }>;
  engagementMetrics(): Promise<{
    counts: Record<EngagementState, number>;
    reengagementRate: number;
    medianDaysSinceLastContact: number;
  }>;
  closureMetrics(): Promise<{ reason: string; count: number }[]>;
  campaignPerformance(): Promise<
    { campaignId: string; name: string; enrolled: number; sent: number; delivered: number; responded: number; completed: number; suppressed: number; failed: number; optedOut: number }[]
  >;
  taskPerformance(): Promise<{
    open: number;
    overdue: number;
    avgCompletionHours: number;
    byOwner: { ownerId: string; open: number; overdue: number }[];
  }>;
  exceptionMetrics(): Promise<{
    byType: { type: string; count: number }[];
    bySeverity: { severity: string; count: number }[];
    openVsResolved: { open: number; resolved: number };
    avgResolutionHours: number;
  }>;
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
}
