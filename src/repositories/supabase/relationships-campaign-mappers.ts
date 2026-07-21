import type { Json } from '@/integrations/supabase/types';
import type {
  RelationshipCampaign,
  RelationshipCampaignBrief,
  RelationshipCampaignDefinitionInput,
  RelationshipCampaignMarketingStage,
  RelationshipCampaignStatus,
  RelationshipCampaignStep,
} from '@/domain/relationships/campaign-contracts';
import {
  relationshipCampaignMarketingStages,
  relationshipCampaignStatuses,
} from '@/domain/relationships/campaign-contracts';

export type RelationshipCampaignRow = {
  id: string;
  tenant_id: string;
  name: string;
  purpose: string;
  initiative: string | null;
  owner_profile_id: string | null;
  sender_name: string;
  sender_email: string;
  status: string;
  marketing_lifecycle_stage: string;
  brief: Json;
  default_timezone: string;
  weekdays_only: boolean;
  send_window_start: string | null;
  send_window_end: string | null;
  execution_enabled: boolean;
  activated_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  version: number;
  created_by_profile_id: string | null;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectValue(value: unknown, label: string) {
  if (!isObject(value)) throw new Error(`Invalid relationship campaign ${label}.`);
  return value;
}

function stringValue(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid relationship campaign ${label}.`);
  return value;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid relationship campaign ${label}.`);
  return value;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function campaignStatus(value: unknown): RelationshipCampaignStatus {
  if (typeof value !== 'string' || !relationshipCampaignStatuses.includes(value as RelationshipCampaignStatus)) {
    throw new Error('Invalid relationship campaign status.');
  }
  return value as RelationshipCampaignStatus;
}

function marketingStage(value: unknown): RelationshipCampaignMarketingStage {
  if (typeof value !== 'string' || !relationshipCampaignMarketingStages.includes(value as RelationshipCampaignMarketingStage)) {
    throw new Error('Invalid relationship campaign marketing lifecycle stage.');
  }
  return value as RelationshipCampaignMarketingStage;
}

function mapBrief(value: unknown): RelationshipCampaignBrief {
  const record = objectValue(value ?? {}, 'brief');
  const text = (key: string) => optionalString(record[key]);
  return {
    sourceDomain: text('sourceDomain'),
    audience: text('audience'),
    objective: text('objective'),
    primaryConversion: text('primaryConversion'),
    cta: text('cta'),
    destination: text('destination'),
    channel: text('channel'),
    geography: text('geography'),
    budgetClass: text('budgetClass'),
    attributionSource: text('attributionSource'),
    receivingDomain: text('receivingDomain'),
    primaryMetric: text('primaryMetric'),
    downstreamMetric: text('downstreamMetric'),
    startDate: text('startDate'),
    reviewDate: text('reviewDate'),
    currentIssue: text('currentIssue'),
    nextDecision: text('nextDecision'),
    excludedAudiences: stringArray(record.excludedAudiences),
    operatingDependencies: stringArray(record.operatingDependencies),
    pauseReviewTriggers: stringArray(record.pauseReviewTriggers),
  };
}

function mapStep(value: unknown): RelationshipCampaignStep {
  const record = objectValue(value, 'step');
  return {
    id: stringValue(record.id, 'step id'),
    position: numberValue(record.position, 'step position'),
    subjectTemplate: stringValue(record.subjectTemplate, 'step subject'),
    bodyTemplate: stringValue(record.bodyTemplate, 'step body'),
    delayDays: numberValue(record.delayDays, 'step delay'),
    stopOnReply: record.stopOnReply !== false,
    isActive: record.isActive !== false,
    createdAt: optionalString(record.createdAt),
    updatedAt: optionalString(record.updatedAt),
  };
}

export function mapRelationshipCampaignResponse(value: Json | undefined): RelationshipCampaign {
  const record = objectValue(value, 'response');
  if (!Array.isArray(record.steps)) throw new Error('Invalid relationship campaign steps.');
  return {
    id: stringValue(record.id, 'id'),
    name: stringValue(record.name, 'name'),
    purpose: stringValue(record.purpose, 'purpose'),
    initiative: optionalString(record.initiative),
    ownerId: optionalString(record.ownerId),
    senderName: stringValue(record.senderName, 'sender name'),
    senderEmail: stringValue(record.senderEmail, 'sender email'),
    status: campaignStatus(record.status),
    marketingLifecycleStage: marketingStage(record.marketingLifecycleStage),
    brief: mapBrief(record.brief),
    defaultTimezone: stringValue(record.defaultTimezone, 'timezone'),
    weekdaysOnly: record.weekdaysOnly !== false,
    sendWindowStart: optionalString(record.sendWindowStart),
    sendWindowEnd: optionalString(record.sendWindowEnd),
    executionEnabled: record.executionEnabled === true,
    activatedAt: optionalString(record.activatedAt),
    completedAt: optionalString(record.completedAt),
    archivedAt: optionalString(record.archivedAt),
    version: numberValue(record.version, 'version'),
    steps: record.steps.map(mapStep),
    metricsAvailable: record.metricsAvailable === true,
    enrollmentCount: typeof record.enrollmentCount === 'number' ? record.enrollmentCount : undefined,
    replyCount: typeof record.replyCount === 'number' ? record.replyCount : undefined,
    suppressionCount: typeof record.suppressionCount === 'number' ? record.suppressionCount : undefined,
    errorCount: typeof record.errorCount === 'number' ? record.errorCount : undefined,
    createdAt: stringValue(record.createdAt, 'created timestamp'),
    updatedAt: stringValue(record.updatedAt, 'updated timestamp'),
    createdBy: optionalString(record.createdBy),
    updatedBy: optionalString(record.updatedBy),
  };
}

export function mapRelationshipCampaignRow(row: RelationshipCampaignRow): RelationshipCampaign {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    initiative: row.initiative ?? undefined,
    ownerId: row.owner_profile_id ?? undefined,
    senderName: row.sender_name,
    senderEmail: row.sender_email,
    status: campaignStatus(row.status),
    marketingLifecycleStage: marketingStage(row.marketing_lifecycle_stage),
    brief: mapBrief(row.brief),
    defaultTimezone: row.default_timezone,
    weekdaysOnly: row.weekdays_only,
    sendWindowStart: row.send_window_start ?? undefined,
    sendWindowEnd: row.send_window_end ?? undefined,
    executionEnabled: row.execution_enabled,
    activatedAt: row.activated_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    version: row.version,
    steps: [],
    metricsAvailable: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by_profile_id ?? undefined,
    updatedBy: row.updated_by_profile_id ?? undefined,
  };
}

export function relationshipCampaignPayload(input: RelationshipCampaignDefinitionInput): Json {
  return {
    name: input.name.trim(),
    purpose: input.purpose.trim(),
    initiative: input.initiative?.trim() || null,
    ownerId: input.ownerId?.trim() || null,
    senderName: input.senderName.trim(),
    senderEmail: input.senderEmail.trim().toLowerCase(),
    marketingLifecycleStage: input.marketingLifecycleStage,
    brief: input.brief as unknown as Json,
    defaultTimezone: input.defaultTimezone.trim(),
    weekdaysOnly: input.weekdaysOnly,
    sendWindowStart: input.sendWindowStart || null,
    sendWindowEnd: input.sendWindowEnd || null,
  };
}

export function relationshipCampaignStepsPayload(input: RelationshipCampaignDefinitionInput): Json {
  return input.steps.map((step) => ({
    subjectTemplate: step.subjectTemplate.trim(),
    bodyTemplate: step.bodyTemplate.trim(),
    delayDays: step.delayDays,
    stopOnReply: step.stopOnReply,
    isActive: step.isActive,
  })) as Json;
}
