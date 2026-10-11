import type {
  CreateOpportunityInput,
  OpportunityStatus,
  RelationshipOpportunity,
  ValidationResult,
} from './contracts';

export const opportunityStatuses: OpportunityStatus[] = [
  'identified',
  'researching',
  'qualified',
  'ready_for_campaign',
  'contacted',
  'responded',
  'interested',
  'pre_interview_scheduled',
  'pre_interview_completed',
  'recording_planned',
  'booked',
  'declined',
  'nurture',
  'disqualified',
  'completed',
];

// Mirrors private.relationship_opportunity_status_transition_allowed.
// Pre-interview = introductory call; recording_planned/booked/completed = full feature recording.
const transitions: Record<OpportunityStatus, OpportunityStatus[]> = {
  identified: ['researching', 'qualified', 'nurture', 'disqualified'],
  researching: ['qualified', 'nurture', 'disqualified'],
  qualified: ['ready_for_campaign', 'contacted', 'nurture', 'disqualified'],
  ready_for_campaign: ['contacted', 'nurture', 'disqualified'],
  contacted: ['responded', 'nurture', 'declined', 'disqualified'],
  responded: ['interested', 'nurture', 'declined'],
  interested: ['pre_interview_scheduled', 'recording_planned', 'booked', 'nurture', 'declined'],
  pre_interview_scheduled: ['pre_interview_completed', 'interested', 'booked', 'nurture', 'declined'],
  pre_interview_completed: ['recording_planned', 'booked', 'nurture', 'declined'],
  recording_planned: ['booked', 'nurture', 'declined'],
  booked: ['completed', 'nurture', 'declined'],
  nurture: ['researching', 'qualified', 'contacted', 'responded', 'interested', 'pre_interview_scheduled', 'disqualified'],
  declined: ['nurture', 'researching'],
  disqualified: ['identified'],
  completed: ['nurture'],
};

const labels: Partial<Record<OpportunityStatus, string>> = {
  pre_interview_scheduled: 'Pre-Interview Scheduled',
  pre_interview_completed: 'Pre-Interview Completed',
};

export function opportunityStatusLabel(status: OpportunityStatus) {
  if (labels[status]) return labels[status]!;
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function allowedOpportunityTransitions(status: OpportunityStatus) {
  return transitions[status];
}

export function validateOpportunityInput(input: Partial<CreateOpportunityInput>): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  if (!input.organizationId?.trim()) fieldErrors.organizationId = 'An organization is required.';
  if (!input.status || !opportunityStatuses.includes(input.status)) fieldErrors.status = 'Select a valid opportunity status.';
  if (input.nextActionDueAt && Number.isNaN(Date.parse(input.nextActionDueAt))) fieldErrors.nextActionDueAt = 'Enter a valid next-action date.';
  if (input.causeArea !== undefined && !input.causeArea.trim()) fieldErrors.causeArea = 'Remove the blank cause area or enter a value.';
  if (input.qualification && (typeof input.qualification !== 'object' || Array.isArray(input.qualification))) {
    fieldErrors.qualification = 'Qualification evidence must be a key-value object.';
  }
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}

export function parseQualificationLines(value: string): RelationshipOpportunity['qualification'] {
  const result: RelationshipOpportunity['qualification'] = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) throw new Error(`Qualification line must use key=value: ${trimmed}`);
    const key = trimmed.slice(0, separator).trim();
    const raw = trimmed.slice(separator + 1).trim();
    if (!key) throw new Error('Qualification keys cannot be blank.');
    if (/^(true|false)$/i.test(raw)) result[key] = raw.toLowerCase() === 'true';
    else if (raw !== '' && Number.isFinite(Number(raw))) result[key] = Number(raw);
    else result[key] = raw;
  }
  return result;
}

export function formatQualificationLines(value: RelationshipOpportunity['qualification']) {
  return Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => `${key}=${String(item)}`)
    .join('\n');
}
