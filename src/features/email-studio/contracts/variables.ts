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
  {
    key: 'first_name',
    label: 'Client first name',
    scope: 'client',
    valueType: 'text',
    sampleValue: 'Jordan',
    description: 'The client first name from the canonical client profile.',
  },
  {
    key: 'preferred_name',
    label: 'Client preferred name',
    scope: 'client',
    valueType: 'text',
    sampleValue: 'Jordan',
    description: 'The client preferred name when one is available.',
  },
  {
    key: 'last_name',
    label: 'Client last name',
    scope: 'client',
    valueType: 'text',
    sampleValue: 'Taylor',
    description: 'The client last name from the canonical client profile.',
  },
  {
    key: 'therapist_name',
    label: 'Therapist name',
    scope: 'client',
    valueType: 'text',
    sampleValue: 'Dr. Morgan Lee',
    description: 'The assigned therapist display name when available.',
  },
  {
    key: 'sender_name',
    label: 'Sender name',
    scope: 'client',
    valueType: 'text',
    sampleValue: 'ValorWell Care Team',
    description: 'The approved sender display name for the communication.',
  },
] as const satisfies readonly EmailVariableDefinitionBase[];

export const RELATIONSHIP_EMAIL_VARIABLES = [
  {
    key: 'contact_first_name',
    label: 'Contact first name',
    scope: 'relationship',
    valueType: 'text',
    sampleValue: 'Alex',
    description: 'The relationship contact first name.',
  },
  {
    key: 'contact_display_name',
    label: 'Contact display name',
    scope: 'relationship',
    valueType: 'text',
    sampleValue: 'Alex Morgan',
    description: 'The best available relationship contact display name.',
  },
  {
    key: 'organization_name',
    label: 'Organization name',
    scope: 'relationship',
    valueType: 'text',
    sampleValue: 'Community Veterans Network',
    description: 'The organization associated with the relationship contact.',
  },
  {
    key: 'organization_type',
    label: 'Organization type',
    scope: 'relationship',
    valueType: 'text',
    sampleValue: 'Community nonprofit',
    description: 'The normalized organization type.',
  },
  {
    key: 'real_action_summary',
    label: 'Real action summary',
    scope: 'relationship',
    valueType: 'text',
    sampleValue: 'Runs weekly peer-support gatherings for local veterans.',
    description: 'A grounded summary of the organization activity supported by source evidence.',
  },
  {
    key: 'cause_area',
    label: 'Cause area',
    scope: 'relationship',
    valueType: 'text',
    sampleValue: 'Veteran mental health',
    description: 'The organization or contact cause area.',
  },
  {
    key: 'opportunity_context',
    label: 'Opportunity context',
    scope: 'relationship',
    valueType: 'text',
    sampleValue: 'A possible Beyond the Yellow collaboration.',
    description: 'The approved relationship opportunity context.',
  },
  {
    key: 'approved_source_sentence',
    label: 'Approved source sentence',
    scope: 'relationship',
    valueType: 'text',
    sampleValue: 'A ValorWell client recommended that we learn more about your work.',
    description: 'The approved, evidence-backed source or introduction sentence.',
  },
  {
    key: 'sender_name',
    label: 'Sender name',
    scope: 'relationship',
    valueType: 'text',
    sampleValue: 'Luke Predmore',
    description: 'The approved relationship outreach sender display name.',
  },
] as const satisfies readonly EmailVariableDefinitionBase[];

export const SYSTEM_EMAIL_VARIABLES = [
  {
    key: 'unsubscribe_url',
    label: 'Unsubscribe URL',
    scope: 'system',
    valueType: 'url',
    sampleValue: 'https://crm.valorwell.org/unsubscribe/example',
    description: 'The recipient-specific unsubscribe URL.',
  },
  {
    key: 'postal_address',
    label: 'Postal address',
    scope: 'system',
    valueType: 'text',
    sampleValue: 'ValorWell, Lee’s Summit, Missouri',
    description: 'The approved physical mailing address for promotional email.',
  },
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
  const allowed = getEmailVariablesForScope(scope).find((variable) => variable.key === canonicalKey);

  if (allowed) {
    return {
      requestedKey,
      canonicalKey: allowed.key,
      definition: allowed,
      aliasUsed: aliasedKey ? requestedKey : undefined,
      status: 'resolved',
    };
  }

  const known = EMAIL_VARIABLES.find((variable) => variable.key === canonicalKey);
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
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    keys.add(match[1]);
  }
  return Array.from(keys).sort();
}

export function normalizeEmailTemplateVariables(template: string, scope: EmailContentScope) {
  const replacements: Array<{ from: string; to: EmailVariableKey }> = [];
  const normalized = template.replace(TOKEN_PATTERN, (token, key: string) => {
    const resolution = resolveEmailVariableKey(key, scope);
    if (resolution.status !== 'resolved' || !resolution.canonicalKey) return token;
    if (resolution.aliasUsed) {
      replacements.push({ from: resolution.aliasUsed, to: resolution.canonicalKey });
    }
    return `{{${resolution.canonicalKey}}}`;
  });

  return { normalized, replacements };
}

export function validateEmailTemplateVariables(template: string, scope: EmailContentScope): EmailValidationResult {
  const issues: EmailValidationIssue[] = [];

  for (const key of extractEmailTemplateVariableKeys(template)) {
    const resolution = resolveEmailVariableKey(key, scope);
    if (resolution.status === 'unknown') {
      issues.push({
        code: 'unknown_variable',
        message: `Unknown email variable {{${key}}}.`,
        severity: 'error',
        variableKey: key,
      });
    } else if (resolution.status === 'disallowed') {
      issues.push({
        code: 'disallowed_variable_scope',
        message: `Email variable {{${key}}} is not available in ${scope} content.`,
        severity: 'error',
        variableKey: key,
      });
    } else if (resolution.aliasUsed && resolution.canonicalKey) {
      issues.push({
        code: 'legacy_variable_alias',
        message: `Legacy variable {{${key}}} is accepted but should be replaced with {{${resolution.canonicalKey}}}.`,
        severity: 'warning',
        variableKey: key,
      });
    }
  }

  return createEmailValidationResult(issues);
}

export function validateEmailVariableValue(definition: EmailVariableDefinition, value: string): string | null {
  if (!value.trim()) return `${definition.label} is required.`;
  if (definition.valueType !== 'url') return null;

  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return `${definition.label} must use an HTTP or HTTPS URL.`;
    }
  } catch {
    return `${definition.label} must be a valid URL.`;
  }

  return null;
}

export function escapeEmailHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
      issues.push({
        code: 'unknown_variable',
        message: `Unknown email variable {{${key}}}.`,
        severity: 'error',
        variableKey: key,
      });
      return token;
    }
    if (resolution.status === 'disallowed' || !resolution.canonicalKey || !resolution.definition) {
      issues.push({
        code: 'disallowed_variable_scope',
        message: `Email variable {{${key}}} is not available in ${scope} content.`,
        severity: 'error',
        variableKey: key,
      });
      return token;
    }

    const value = values[resolution.canonicalKey];
    if (value === undefined) {
      issues.push({
        code: 'missing_variable_value',
        message: `No value was supplied for {{${resolution.canonicalKey}}}.`,
        severity: 'error',
        variableKey: resolution.canonicalKey,
      });
      return token;
    }

    const valueError = validateEmailVariableValue(resolution.definition, value);
    if (valueError) {
      issues.push({
        code: resolution.definition.valueType === 'url' ? 'invalid_url_variable' : 'invalid_variable_value',
        message: valueError,
        severity: 'error',
        variableKey: resolution.canonicalKey,
      });
      return token;
    }

    return outputFormat === 'html' ? escapeEmailHtml(value) : value;
  });

  return {
    output,
    validation: createEmailValidationResult(dedupeIssues(issues)),
  };
}

function dedupeIssues(issues: EmailValidationIssue[]): EmailValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.variableKey ?? ''}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
