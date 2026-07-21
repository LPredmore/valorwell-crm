import type {
  ImportColumnMapping,
  ImportConflictDecision,
  ImportField,
} from './contracts';
import type {
  RelationshipImportDecision,
  RelationshipImportRow,
} from './import-contracts';

export type ImportFieldDefinition = {
  value: ImportField;
  label: string;
  description: string;
  aliases: string[];
};

export const importFieldDefinitions: ImportFieldDefinition[] = [
  { value: 'organization_name', label: 'Organization name', description: 'Required. Canonical organization or business name.', aliases: ['organization', 'organization name', 'org', 'org name', 'company', 'company name', 'business', 'business name'] },
  { value: 'website', label: 'Website', description: 'Organization website used for duplicate matching.', aliases: ['website', 'web site', 'company website', 'organization website', 'url'] },
  { value: 'organization_type', label: 'Organization type', description: 'Non-clinical organization category.', aliases: ['organization type', 'org type', 'company type', 'business type', 'type'] },
  { value: 'state', label: 'State', description: 'US state or regional code.', aliases: ['state', 'province', 'region'] },
  { value: 'veteran_affiliation', label: 'Veteran affiliation', description: 'Yes/no veteran affiliation flag.', aliases: ['veteran', 'veteran affiliated', 'veteran affiliation', 'veteran owned'] },
  { value: 'contact_name', label: 'Contact name', description: 'Person or role-inbox display name.', aliases: ['contact', 'contact name', 'full name', 'person', 'person name'] },
  { value: 'contact_email', label: 'Contact email', description: 'Normalized email and strongest contact duplicate signal.', aliases: ['email', 'email address', 'contact email', 'contact email address'] },
  { value: 'contact_phone', label: 'Contact phone', description: 'Contact telephone number.', aliases: ['phone', 'telephone', 'phone number', 'contact phone'] },
  { value: 'contact_kind', label: 'Contact kind', description: 'person or role_inbox.', aliases: ['contact kind', 'contact type', 'person type'] },
  { value: 'contact_title', label: 'Contact title', description: 'Role or title at the organization.', aliases: ['contact title', 'job title', 'position', 'role title'] },
  { value: 'source_category', label: 'Source category', description: 'Referral or provenance category.', aliases: ['source', 'source category', 'referral source', 'recommendation source'] },
  { value: 'source_summary', label: 'Source summary', description: 'Why this record was sourced or recommended.', aliases: ['source summary', 'referral summary', 'recommendation', 'recommendation summary', 'source details'] },
  { value: 'social_platform', label: 'Social platform', description: 'YouTube, TikTok, Instagram, LinkedIn, or another platform.', aliases: ['platform', 'social platform', 'network'] },
  { value: 'social_handle', label: 'Social handle', description: 'Platform username without a leading @.', aliases: ['handle', 'username', 'social handle', 'social username'] },
  { value: 'social_url', label: 'Social profile URL', description: 'Full social-profile URL.', aliases: ['social url', 'profile url', 'social profile', 'social profile url'] },
  { value: 'role_code', label: 'Relationship role code', description: 'Active relationship role such as bty_nominee.', aliases: ['role', 'role code', 'relationship role', 'relationship role code'] },
  { value: 'bty_status', label: 'BTY status', description: 'Opportunity status for Beyond The Yellow.', aliases: ['status', 'bty status', 'opportunity status', 'pipeline status'] },
  { value: 'bty_cause_area', label: 'BTY cause area', description: 'Cause area or community mission.', aliases: ['cause', 'cause area', 'bty cause', 'bty cause area', 'mission area'] },
  { value: 'bty_audience_reach', label: 'BTY audience reach', description: 'Numeric audience or follower count.', aliases: ['reach', 'audience', 'audience reach', 'followers', 'follower count'] },
];

export const importConflictDecisionLabels: Record<ImportConflictDecision, string> = {
  link_organization: 'Link existing organization',
  link_contact: 'Link existing contact',
  create_organization: 'Create a separate organization',
  create_contact: 'Create a new contact',
  exclude: 'Exclude this row',
  correct_source: 'Correct row data and re-check',
  defer: 'Defer this conflict',
};

function normalizedHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function suggestImportMapping(headers: string[]): ImportColumnMapping {
  const mapping: ImportColumnMapping = {};
  const assigned = new Set<ImportField>();

  for (const header of headers) {
    const normalized = normalizedHeader(header);
    const definition = importFieldDefinitions.find((candidate) => {
      if (assigned.has(candidate.value)) return false;
      return normalized === normalizedHeader(candidate.value)
        || candidate.aliases.some((alias) => normalized === normalizedHeader(alias));
    });
    mapping[header] = definition?.value ?? 'ignore';
    if (definition) assigned.add(definition.value);
  }

  return mapping;
}

export function mappedFieldDuplicates(mapping: ImportColumnMapping) {
  const counts = new Map<string, number>();
  for (const field of Object.values(mapping)) {
    if (field === 'ignore') continue;
    counts.set(field, (counts.get(field) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([field]) => field as ImportField);
}

export function validateImportMapping(mapping: ImportColumnMapping) {
  const errors: string[] = [];
  if (!Object.values(mapping).includes('organization_name')) {
    errors.push('Map one CSV column to Organization name.');
  }
  const duplicates = mappedFieldDuplicates(mapping);
  if (duplicates.length) {
    errors.push(`Each destination field can be mapped once. Duplicates: ${duplicates.join(', ')}.`);
  }
  return errors;
}

export function conflictDecisionsForRow(row: RelationshipImportRow): ImportConflictDecision[] {
  const decisions: ImportConflictDecision[] = [];
  const hasOrganization = row.candidates.some((candidate) => candidate.entity === 'organization');
  const hasContact = row.candidates.some((candidate) => candidate.entity === 'contact');

  if (hasContact) decisions.push('link_contact');
  if (hasOrganization && !hasContact) decisions.push('link_organization');
  if (hasOrganization && !hasContact) decisions.push('create_contact');
  if (!hasContact) decisions.push('create_organization');
  decisions.push('correct_source', 'exclude', 'defer');
  return [...new Set(decisions)];
}

export function importDecisionLabel(decision: RelationshipImportDecision) {
  return decision.replace(/_/g, ' ').replace(/^./, (value) => value.toUpperCase());
}

export function importDecisionTone(decision: RelationshipImportDecision): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (decision === 'invalid') return 'destructive';
  if (decision === 'duplicate' || decision === 'ambiguous') return 'secondary';
  if (decision === 'excluded') return 'outline';
  return 'default';
}

export function parseCorrectedImportData(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Corrected data must be valid JSON.');
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Corrected data must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
