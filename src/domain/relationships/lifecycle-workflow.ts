import {
  canTransition,
  relationshipStages,
  type InteractionType,
  type RelationshipStage,
  type ValidationResult,
} from './contracts';

export const relationshipStageLabels: Record<RelationshipStage, string> = {
  identified: 'Identified',
  qualified_outreach: 'Qualified for outreach',
  contacted: 'Contacted',
  engaged: 'Engaged',
  discovery: 'Discovery',
  next_step_agreed: 'Next step agreed',
  active: 'Active relationship',
  nurture: 'Nurture',
  closed_no_fit: 'Closed — no fit',
  inactive: 'Inactive',
};

export const manualInteractionTypes = [
  'manual_note',
  'phone_call',
  'meeting',
  'outbound_email',
  'inbound_reply',
] as const satisfies readonly InteractionType[];

export type ManualInteractionType = (typeof manualInteractionTypes)[number];

export const interactionTypeLabels: Partial<Record<InteractionType, string>> = {
  manual_note: 'Manual note',
  phone_call: 'Phone call',
  meeting: 'Meeting',
  outbound_email: 'Outbound email',
  inbound_reply: 'Inbound reply',
  stage_transition: 'Stage transition',
  owner_change: 'Owner change',
  next_action_change: 'Next-action change',
  referral_verification: 'Referral verification',
  opportunity_status_change: 'Opportunity status change',
  campaign_enrollment: 'Campaign enrollment',
  campaign_stop: 'Campaign stop',
  suppression: 'Suppression',
  unsubscribe: 'Unsubscribe',
  import: 'Import',
  system: 'System event',
};

export function relationshipStageLabel(stage?: RelationshipStage) {
  return stage ? relationshipStageLabels[stage] : 'Unavailable';
}

export function interactionTypeLabel(type: InteractionType) {
  return interactionTypeLabels[type] ?? type.replace(/_/g, ' ');
}

export function availableRelationshipStageTransitions(current?: RelationshipStage) {
  return current
    ? relationshipStages.filter((stage) => canTransition(current, stage))
    : [];
}

export function validateStageTransitionDraft(input: {
  from?: RelationshipStage;
  to?: RelationshipStage;
  reason: string;
}): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  if (!input.from) fieldErrors.from = 'The current lifecycle stage is unavailable.';
  if (!input.to) fieldErrors.to = 'Select the next lifecycle stage.';
  if (input.from && input.to && !canTransition(input.from, input.to)) {
    fieldErrors.to = 'That lifecycle transition is not allowed.';
  }
  if (!input.reason.trim()) {
    fieldErrors.reason = 'Record a reason for the lifecycle change.';
  }
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}

export function validateInteractionDraft(input: {
  type: InteractionType;
  occurredAt: string;
  summary: string;
}): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  if (!manualInteractionTypes.includes(input.type as ManualInteractionType)) {
    fieldErrors.type = 'Select a supported manual interaction type.';
  }
  if (!input.occurredAt || Number.isNaN(new Date(input.occurredAt).getTime())) {
    fieldErrors.occurredAt = 'Enter a valid interaction date and time.';
  }
  if (!input.summary.trim()) {
    fieldErrors.summary = 'Describe the relationship interaction.';
  }
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}
