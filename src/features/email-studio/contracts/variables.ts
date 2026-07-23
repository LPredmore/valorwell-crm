import {
  createEmailValidationResult,
  type EmailValidationIssue,
  type EmailValidationResult,
} from './document';

export type EmailContentScope = 'client' | 'relationship';
export type EmailVariableScope = EmailContentScope | 'system';
export type EmailVariableValueType = 'text' | 'url';

type EmailVariableDefinitionBase = {
  key: string;
  label: string;
  scope: EmailVariableScope;
  valueType: EmailVariableValueType;
  sampleValue: string;
  description: string;
};

export const CLIENT_EMAIL_VARIABLES = [
  variable('first_name', 'Client first name', 'client', 'text', 'Jordan', 'Canonical client first name.'),
  variable('preferred_name', 'Client preferred name', 'client', 'text', 'Jordan', 'Canonical client preferred name.'),
  variable('last_name', 'Client last name', 'client', 'text', 'Taylor', 'Canonical client last name.'),
  variable('therapist_name', 'Therapist name', 'client', 'text', 'Dr. Morgan Lee', 'Assigned therapist display name.'),
  variable('sender_name', 'Sender name', 'client', 'text', 'ValorWell Care Team', 'Approved client-email sender name.'),
] as const satisfies readonly EmailVariableDefinitionBase[];

export const RELATIONSHIP_EMAIL_VARIABLES = [
  variable('contact_first_name', 'Contact first name', 'relationship', 'text', 'Alex', 'Relationship contact first name.'),
  variable('contact_display_name', 'Contact display name', 'relationship', 'text', 'Alex Morgan', 'Best available contact display name.'),
  variable('organization_name', 'Organization name', 'relationship', 'text', 'Community Veterans Network', 'Associated organization name.'),
  variable('organization_type', 'Organization type', 'relationship', 'text', 'Community nonprofit', 'Normalized organization type.'),
  variable('real_action_summary', 'Real action summary', 'relationship', 'text', 'Runs weekly peer-support gatherings for local veterans.', 'Evidence-backed summary of real activity.'),
  variable('cause_area', 'Cause area', 'relationship', 'text', 'Veteran mental health', 'Organization or contact cause area.'),
  variable('opportunity_context', 'Opportunity context', 'relationship', 'text', 'A possible Beyond the Yellow collaboration.', 'Approved opportunity context.'),
  variable('approved_source_sentence', 'Approved source sentence', 'relationship', 'text', 'A ValorWell client recommended that we learn more about your work.', 'Approved evidence-backed introduction sentence.'),
  variable('sender_name', 'Sender name', 'relationship', 'text', 'Luke Predmore', 'Approved relationship-outreach sender name.'),
] as const satisfies readonly EmailVariableDefinitionBase[];

export const SYSTEM_EMAIL_VARIABLES = [
  variable('unsubscribe_url', 'Unsubscribe URL', 'system', 'url', 'https://crm.valorwell.org/unsubscribe/example', 'Recipient-specific unsubscribe URL.'),
  variable('postal_address', 'Postal address', 'system', 'text', 'ValorWell, Lee’s Summit, Missouri', 'Approved physical mailing address.'),
] as const satisfies readonly EmailVariableDefinitionBase[];

export const EMAIL_VARIABLES = [
  ...CLIENT_EMAIL_VARIABLES,
  ...RELATIONSHIP_EMAIL_VARIABLES,
  ...SYSTEM_EMAIL_VARIABLES,
] as const;

export type EmailVariableDefinition = (typeof EMAIL_VARIABLES)[number];
export type EmailVariableKey = EmailVariableDefinition['key'];

export const LEGACY_EMAIL_VARIABLE_ALIASES = {
  client: {},
  relationship: {
    recipient_name: 'contact_display_name',
    first_name: 'contact_first_name',
    unsubscribe_link: 'unsubscribe_url',
    valorwell_postal_address: 'postal_address',
  },
} as const satisfies Record<EmailContentScope, Record<string, EmailVariableKey>>;

export type EmailVariableResolution = {
  requestedKey: string;
  canonicalKey?: EmailVariableKey;
  definition?: EmailVariableDefinition;
  aliasUsed?: string;
  status: 'resolved' | 'unknown' | 'disallowed';
};

export type EmailTemplateRenderResult = {
  output: string;
  validation: EmailValidationResult;
};

const TOKEN_PATTERN = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;

export function getEmailVariablesForScope(scope: EmailContentScope): readonly EmailVariableDefinition[] {
  const scoped = scope === 'client' ? CLIENT_EMAIL_VARIABLES : RELATIONSHIP_EMAIL_VARIABLES;
  return [...scoped, ...SYSTEM_EMAIL_VARIABLES];
}

export function resolveEmailVariableKey(key: string, scope: EmailContentScope): EmailVariableResolution {
  const requestedKey = key.trim();
  const aliases = LEGACY_EMAIL_VARIABLE_ALIASES[scope] as Record<string, EmailVariableKey>;
  const aliasedKey = aliases[requestedKey];
  const canonicalKey = aliasedKey ?? requestedKey;
  const allowed = getEmailVariablesForScope(scope).find((entry) => entry.key === canonicalKey);

  if (allowed) {
    return {
      requestedKey,
      canonicalKey: allowed.key,
      definition: allowed,
      aliasUsed: aliasedKey ? requestedKey : undefined,
      status: 'resolved',
    };
  }

  const known = EMAIL_VARIABLES.find((entry) => entry.key === canonicalKey);
  return {
    requestedKey,
    canonicalKey: known?.key,
    definition: known,
    aliasUsed: aliasedKey ? requestedKey : undefined,
    status: known ? 'disallowed' : 'unknown',
  };
}

export function extractEmailTemplateVariableKeys(template: string): string[] {
  const keys = new Set<string>();
  for (const match of template.matchAll(TOKEN_PATTERN)) keys.add(match[1]);
  return Array.from(keys).sort();
}

export function normalizeEmailTemplateVariables(template: string, scope: EmailContentScope) {
  const replacements: Array<{ from: string; to: EmailVariableKey }> = [];
  const normalized = template.replace(TOKEN_PATTERN, (token, key: string) => {
    const resolution = resolveEmailVariableKey(key, scope);
    if (resolution.status !== 'resolved' || !resolution.canonicalKey) return token;
    if (resolution.aliasUsed) replacements.push({ from: resolution.aliasUsed, to: resolution.canonicalKey });
    return `{{${resolution.canonicalKey}}}`;
  });
  return { normalized, replacements };
}

export function validateEmailTemplateVariables(template: string, scope: EmailContentScope): EmailValidationResult {
  const issues: EmailValidationIssue[] = [];
  for (const key of extractEmailTemplateVariableKeys(template)) {
    const resolution = resolveEmailVariableKey(key, scope);
    if (resolution.status === 'unknown') {
      issues.push(issue('unknown_variable', `Unknown email variable {{${key}}}.`, 'error', key));
    } else if (resolution.status === 'disallowed') {
      issues.push(issue('disallowed_variable_scope', `Email variable {{${key}}} is not available in ${scope} content.`, 'error', key));
    } else if (resolution.aliasUsed && resolution.canonicalKey) {
      issues.push(issue('legacy_variable_alias', `Legacy variable {{${key}}} is accepted but should be replaced with {{${resolution.canonicalKey}}}.`, 'warning', key));
    }
  }
  return createEmailValidationResult(issues);
}

export function validateEmailVariableValue(definition: EmailVariableDefinition, value: string): string | null {
  if (!value.trim()) return `${definition.label} is required.`;
  if (definition.valueType !== 'url') return null;
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) return `${definition.label} must use an HTTP or HTTPS URL.`;
  } catch {
    return `${definition.label} must be a valid URL.`;
  }
  return null;
}

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderEmailTemplate(
  template: string,
  scope: EmailContentScope,
  values: Partial<Record<EmailVariableKey, string>>,
  outputFormat: 'html' | 'text',
): EmailTemplateRenderResult {
  const issues: EmailValidationIssue[] = [];
  const output = template.replace(TOKEN_PATTERN, (token, key: string) => {
    const resolution = resolveEmailVariableKey(key, scope);
    if (resolution.status === 'unknown') {
      issues.push(issue('unknown_variable', `Unknown email variable {{${key}}}.`, 'error', key));
      return token;
    }
    if (resolution.status === 'disallowed' || !resolution.canonicalKey || !resolution.definition) {
      issues.push(issue('disallowed_variable_scope', `Email variable {{${key}}} is not available in ${scope} content.`, 'error', key));
      return token;
    }

    const value = values[resolution.canonicalKey];
    if (value === undefined) {
      issues.push(issue('missing_variable_value', `No value was supplied for {{${resolution.canonicalKey}}}.`, 'error', resolution.canonicalKey));
      return token;
    }

    const valueError = validateEmailVariableValue(resolution.definition, value);
    if (valueError) {
      issues.push(issue(resolution.definition.valueType === 'url' ? 'invalid_url_variable' : 'invalid_variable_value', valueError, 'error', resolution.canonicalKey));
      return token;
    }

    return outputFormat === 'html' ? escapeEmailHtml(value) : value;
  });

  return {
    output,
    validation: createEmailValidationResult(dedupeIssues(issues)),
  };
}

function variable<
  const Key extends string,
  const Label extends string,
  const Scope extends EmailVariableScope,
  const ValueType extends EmailVariableValueType,
>(
  key: Key,
  label: Label,
  scope: Scope,
  valueType: ValueType,
  sampleValue: string,
  description: string,
): {
  key: Key;
  label: Label;
  scope: Scope;
  valueType: ValueType;
  sampleValue: string;
  description: string;
} {
  return { key, label, scope, valueType, sampleValue, description };
}

function issue(
  code: string,
  message: string,
  severity: 'error' | 'warning',
  variableKey: string,
): EmailValidationIssue {
  return { code, message, severity, variableKey };
}

function dedupeIssues(issues: EmailValidationIssue[]): EmailValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.code}:${entry.variableKey ?? ''}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
