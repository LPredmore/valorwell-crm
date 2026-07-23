import { validateEmailTemplateVariables } from '@/features/email-studio/contracts';
import type {
  RelationshipCampaign,
  RelationshipCampaignBrief,
  RelationshipCampaignDefinitionInput,
  RelationshipCampaignStatus,
} from './campaign-contracts';

const requiredBriefFields: Array<keyof RelationshipCampaignBrief> = [
  'sourceDomain',
  'audience',
  'objective',
  'primaryConversion',
  'cta',
  'destination',
  'channel',
  'budgetClass',
  'attributionSource',
  'receivingDomain',
  'primaryMetric',
];

export function campaignBriefErrors(brief: RelationshipCampaignBrief) {
  const errors: string[] = [];
  for (const field of requiredBriefFields) {
    const value = brief[field];
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`${field} is required.`);
    }
  }
  if (!brief.pauseReviewTriggers.some((value) => value.trim())) {
    errors.push('At least one pause or review trigger is required.');
  }
  return errors;
}

export function campaignDefinitionErrors(input: RelationshipCampaignDefinitionInput) {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push('Campaign name is required.');
  if (!input.purpose.trim()) errors.push('Campaign purpose is required.');
  if (!input.senderName.trim()) errors.push('Sender name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.senderEmail.trim())) {
    errors.push('Sender email is invalid.');
  }
  if (!input.defaultTimezone.trim()) errors.push('Default timezone is required.');
  if ((input.sendWindowStart && !input.sendWindowEnd) || (!input.sendWindowStart && input.sendWindowEnd)) {
    errors.push('Send window start and end must be supplied together.');
  }
  if (input.sendWindowStart && input.sendWindowEnd && input.sendWindowStart >= input.sendWindowEnd) {
    errors.push('Send window start must be earlier than the end.');
  }
  if (input.steps.length > 20) errors.push('Campaigns are limited to 20 steps.');
  input.steps.forEach((step, index) => {
    if (!step.subjectTemplate.trim()) errors.push(`Step ${index + 1} requires a subject template.`);
    if (!step.bodyTemplate.trim()) errors.push(`Step ${index + 1} requires a body template.`);
    if (!Number.isInteger(step.delayDays) || step.delayDays < 0 || step.delayDays > 365) {
      errors.push(`Step ${index + 1} delay must be between 0 and 365 days.`);
    }

    for (const issue of validateEmailTemplateVariables(step.subjectTemplate, 'relationship').errors) {
      errors.push(`Step ${index + 1} subject: ${issue.message}`);
    }
    for (const issue of validateEmailTemplateVariables(step.bodyTemplate, 'relationship').errors) {
      errors.push(`Step ${index + 1} body: ${issue.message}`);
    }
  });
  return errors;
}

export function campaignDefinitionWarnings(input: RelationshipCampaignDefinitionInput) {
  const warnings: string[] = [];
  input.steps.forEach((step, index) => {
    for (const issue of validateEmailTemplateVariables(step.subjectTemplate, 'relationship').warnings) {
      warnings.push(`Step ${index + 1} subject: ${issue.message}`);
    }
    for (const issue of validateEmailTemplateVariables(step.bodyTemplate, 'relationship').warnings) {
      warnings.push(`Step ${index + 1} body: ${issue.message}`);
    }
  });
  return warnings;
}

export function campaignActivationErrors(input: RelationshipCampaignDefinitionInput) {
  const errors = [...campaignDefinitionErrors(input), ...campaignBriefErrors(input.brief)];
  if (input.marketingLifecycleStage !== 'ready') {
    errors.push('Marketing lifecycle must be Ready before activation.');
  }
  if (!input.steps.some((step) => step.isActive)) {
    errors.push('At least one active campaign step is required.');
  }
  return errors;
}

export function allowedCampaignTransitions(status: RelationshipCampaignStatus) {
  const transitions: Record<RelationshipCampaignStatus, RelationshipCampaignStatus[]> = {
    draft: ['active', 'archived'],
    active: ['paused', 'completed'],
    paused: ['active', 'completed', 'archived'],
    completed: ['archived'],
    archived: [],
  };
  return transitions[status];
}

export function canEditCampaign(campaign: Pick<RelationshipCampaign, 'status'>) {
  return campaign.status === 'draft' || campaign.status === 'paused';
}

export function emptyRelationshipCampaignDefinition(): RelationshipCampaignDefinitionInput {
  return {
    name: '',
    purpose: '',
    initiative: '',
    ownerId: '',
    senderName: '',
    senderEmail: '',
    marketingLifecycleStage: 'source_lock',
    brief: {
      sourceDomain: '',
      audience: '',
      objective: '',
      primaryConversion: '',
      cta: '',
      destination: '',
      channel: 'Email',
      geography: '',
      budgetClass: '',
      attributionSource: '',
      receivingDomain: 'Business Development',
      primaryMetric: '',
      downstreamMetric: '',
      startDate: '',
      reviewDate: '',
      currentIssue: '',
      nextDecision: '',
      excludedAudiences: [],
      operatingDependencies: [],
      pauseReviewTriggers: [],
    },
    defaultTimezone: 'America/Chicago',
    weekdaysOnly: true,
    sendWindowStart: '09:00',
    sendWindowEnd: '17:00',
    steps: [{
      subjectTemplate: '',
      bodyTemplate: '',
      delayDays: 0,
      stopOnReply: true,
      isActive: true,
    }],
  };
}

export function campaignToDefinition(campaign: RelationshipCampaign): RelationshipCampaignDefinitionInput {
  return {
    name: campaign.name,
    purpose: campaign.purpose,
    initiative: campaign.initiative ?? '',
    ownerId: campaign.ownerId ?? '',
    senderName: campaign.senderName,
    senderEmail: campaign.senderEmail,
    marketingLifecycleStage: campaign.marketingLifecycleStage,
    brief: {
      ...campaign.brief,
      excludedAudiences: campaign.brief.excludedAudiences ?? [],
      operatingDependencies: campaign.brief.operatingDependencies ?? [],
      pauseReviewTriggers: campaign.brief.pauseReviewTriggers ?? [],
    },
    defaultTimezone: campaign.defaultTimezone,
    weekdaysOnly: campaign.weekdaysOnly,
    sendWindowStart: campaign.sendWindowStart?.slice(0, 5),
    sendWindowEnd: campaign.sendWindowEnd?.slice(0, 5),
    steps: campaign.steps.map((step) => ({
      subjectTemplate: step.subjectTemplate,
      bodyTemplate: step.bodyTemplate,
      delayDays: step.delayDays,
      stopOnReply: step.stopOnReply,
      isActive: step.isActive,
    })),
  };
}
