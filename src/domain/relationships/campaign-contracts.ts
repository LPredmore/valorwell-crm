import type { EmailContentDocument } from '@/features/email-studio/contracts';
import type { AuditMetadata, PageResult, SortDirection } from './contracts';

export const relationshipCampaignStatuses = ['draft', 'active', 'paused', 'completed', 'archived'] as const;
export type RelationshipCampaignStatus = (typeof relationshipCampaignStatuses)[number];

export const relationshipCampaignMarketingStages = [
  'source_lock',
  'brief',
  'ready',
  'live',
  'measure',
  'improve',
  'pause',
  'stop_supersede',
] as const;
export type RelationshipCampaignMarketingStage = (typeof relationshipCampaignMarketingStages)[number];

export type RelationshipCampaignBrief = {
  sourceDomain?: string;
  audience?: string;
  objective?: string;
  primaryConversion?: string;
  cta?: string;
  destination?: string;
  channel?: string;
  geography?: string;
  budgetClass?: string;
  attributionSource?: string;
  receivingDomain?: string;
  primaryMetric?: string;
  downstreamMetric?: string;
  startDate?: string;
  reviewDate?: string;
  currentIssue?: string;
  nextDecision?: string;
  excludedAudiences: string[];
  operatingDependencies: string[];
  pauseReviewTriggers: string[];
};

export type RelationshipCampaignStep = {
  id: string;
  position: number;
  subjectTemplate: string;
  bodyTemplate: string;
  emailContent?: EmailContentDocument;
  templateId?: string;
  templateVersionId?: string;
  delayDays: number;
  stopOnReply: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type RelationshipCampaign = AuditMetadata & {
  id: string;
  name: string;
  purpose: string;
  initiative?: string;
  ownerId?: string;
  senderName: string;
  senderEmail: string;
  status: RelationshipCampaignStatus;
  marketingLifecycleStage: RelationshipCampaignMarketingStage;
  brief: RelationshipCampaignBrief;
  defaultTimezone: string;
  weekdaysOnly: boolean;
  sendWindowStart?: string;
  sendWindowEnd?: string;
  executionEnabled: boolean;
  activatedAt?: string;
  completedAt?: string;
  archivedAt?: string;
  version: number;
  steps: RelationshipCampaignStep[];
  metricsAvailable: boolean;
  enrollmentCount?: number;
  replyCount?: number;
  suppressionCount?: number;
  errorCount?: number;
};

export type RelationshipCampaignDefinitionInput = {
  name: string;
  purpose: string;
  initiative?: string;
  ownerId?: string;
  senderName: string;
  senderEmail: string;
  marketingLifecycleStage: RelationshipCampaignMarketingStage;
  brief: RelationshipCampaignBrief;
  defaultTimezone: string;
  weekdaysOnly: boolean;
  sendWindowStart?: string;
  sendWindowEnd?: string;
  steps: Array<Omit<RelationshipCampaignStep, 'id' | 'position' | 'createdAt' | 'updatedAt'>>;
};

export type RelationshipCampaignFilters = {
  statuses?: RelationshipCampaignStatus[];
  ownerIds?: string[];
  initiatives?: string[];
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'name' | 'status' | 'createdAt' | 'updatedAt';
  sortDirection?: SortDirection;
};

export type RelationshipCampaignPage = PageResult<RelationshipCampaign>;

export type RelationshipCampaignTransitionInput = {
  status: RelationshipCampaignStatus;
  expectedVersion: number;
  idempotencyKey?: string;
  reason?: string;
};
