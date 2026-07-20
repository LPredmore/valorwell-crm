import type { CommunicationPersonalizationContext, PersonalizationResult, Referral } from '@/domain/relationships/contracts';
import { sourceLanguageSentence } from '@/domain/relationships/source-language';

type AllowedVariableName =
  | 'contact_first_name'
  | 'contact_display_name'
  | 'organization_name'
  | 'organization_type'
  | 'real_action_summary'
  | 'cause_area'
  | 'opportunity_context'
  | 'sender_name'
  | 'valorwell_postal_address'
  | 'unsubscribe_link'
  | 'approved_source_sentence';

const allowedVariables = new Set<AllowedVariableName>([
  'contact_first_name',
  'contact_display_name',
  'organization_name',
  'organization_type',
  'real_action_summary',
  'cause_area',
  'opportunity_context',
  'sender_name',
  'valorwell_postal_address',
  'unsubscribe_link',
  'approved_source_sentence',
]);

function normalizeValue(value?: string) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function valueFor(variable: AllowedVariableName, context: CommunicationPersonalizationContext, referral?: Referral) {
  switch (variable) {
    case 'contact_first_name':
      if (context.contactKind === 'role_inbox') return normalizeValue(context.contactDisplayName);
      return normalizeValue(context.contactFirstName) ?? normalizeValue(context.contactDisplayName);
    case 'contact_display_name':
      return normalizeValue(context.contactDisplayName) ?? (context.contactKind === 'person' ? normalizeValue(context.contactFirstName) : undefined);
    case 'organization_name':
      return normalizeValue(context.organizationName);
    case 'organization_type':
      return normalizeValue(context.organizationType);
    case 'real_action_summary':
      return normalizeValue(context.realActionSummary);
    case 'cause_area':
      return normalizeValue(context.causeArea);
    case 'opportunity_context':
      return normalizeValue(context.opportunityContext);
    case 'sender_name':
      return normalizeValue(context.senderName);
    case 'valorwell_postal_address':
      return normalizeValue(context.postalAddress);
    case 'unsubscribe_link':
      return normalizeValue(context.unsubscribeUrl);
    case 'approved_source_sentence':
      return sourceLanguageSentence(referral).sentence;
  }
}

function blockedClaimsIn(template: string) {
  const matches = Array.from(template.matchAll(/\{\{([a-z0-9_]+)\}\}/gi));
  return matches.flatMap(([, variable]) => {
    const normalized = variable.toLowerCase();
    if (!allowedVariables.has(normalized as AllowedVariableName) && (normalized.includes('source') || normalized.includes('referral') || normalized.includes('claim'))) {
      return [`Blocked referral-claim variable: {{${variable}}}`];
    }
    return [];
  });
}

export function resolveRelationshipCampaignPersonalization(
  template: string,
  context: CommunicationPersonalizationContext,
  referral?: Referral,
): PersonalizationResult {
  const unresolvedVariables: string[] = [];
  const blockedClaims = blockedClaimsIn(template);

  const rendered = template.replace(/\{\{([a-z0-9_]+)\}\}/gi, (match, variableName) => {
    const normalized = variableName.toLowerCase();
    const isBlocked = blockedClaims.some((claim) => claim.includes(`{{${variableName}}}`));
    if (isBlocked) {
      return match;
    }
    if (!allowedVariables.has(normalized as AllowedVariableName)) {
      unresolvedVariables.push(match);
      return match;
    }

    const value = valueFor(normalized as AllowedVariableName, context, referral);
    if (value === undefined) {
      unresolvedVariables.push(match);
      return match;
    }

    return value;
  });

  return { rendered, unresolvedVariables, blockedClaims };
}
