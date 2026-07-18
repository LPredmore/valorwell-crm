export const INTEREST_ROLE_OPTIONS = [
  { code: 'creator', label: 'Creator' },
  { code: 'bty_promoter', label: 'BTY promoter' },
  { code: 'storyteller', label: 'Storyteller' },
  { code: 'bty_story_submitter', label: 'BTY story submitter' },
  { code: 'podcaster', label: 'Podcaster' },
  { code: 'connector', label: 'Connector' },
  { code: 'funder', label: 'Funder' },
  { code: 'supporter', label: 'Supporter' },
  { code: 'general_mission_interest', label: 'General mission interest' },
] as const;

export const INTEREST_ROLE_CODES = INTEREST_ROLE_OPTIONS.map(({ code }) => code);

export const REVIEW_STATES = [
  'review_needed',
  'direct_outreach',
  'nurture',
  'not_relevant',
  'duplicate',
  'invalid_spam',
  'managed',
] as const;

export const OUTREACH_STATUSES = [
  'new',
  'reviewing',
  'contacted',
  'engaged',
  'waiting',
  'closed',
  'do_not_contact',
] as const;

export const VETERAN_AFFILIATIONS = [
  'unknown',
  'veteran',
  'family_member',
  'military_connected',
  'none',
] as const;

export const STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'GU', 'VI', 'AS', 'MP', 'AE', 'AA', 'AP',
] as const;

export const COMFORT_LEVELS = [
  'public_story',
  'private_conversation',
  'behind_the_scenes',
  'flexible',
  'not_sure',
] as const;

export type InterestRoleCode = (typeof INTEREST_ROLE_CODES)[number];

export function isInterestRoleCode(value: string): value is InterestRoleCode {
  return (INTEREST_ROLE_CODES as readonly string[]).includes(value);
}

export type ReviewState = (typeof REVIEW_STATES)[number];
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];
export type InterestSort = 'newest' | 'oldest_unreviewed' | 'followers' | 'due' | 'name';

export interface InterestContact {
  id: string;
  tenantId: string;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  veteranAffiliation: string;
  outreachStatus: string;
  reviewState: string;
  ownerProfileId: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  lastContactAt: string | null;
  doNotContact: boolean;
  source: string;
  sourceRecordKey: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface InterestProfile {
  contactId: string;
  motivation: string | null;
  veteranConnection: string | null;
  willingToShare: boolean | null;
  comfortLevel: string | null;
  fundraisingGoal: string | null;
  additionalInfo: string | null;
  acceptedRules: boolean | null;
  highestFollowerPlatform: string | null;
  highestFollowerCount: number | null;
  personalMission: string | null;
  avatarUrl: string | null;
  profileComplete: boolean | null;
  pastCompetitions: unknown;
  isCompeting: boolean;
  status: string;
  source: string;
  sourceRecordKey: string | null;
  metadata: Record<string, unknown>;
}

export interface InterestSocial {
  id: string;
  platformName: string;
  handle: string | null;
  profileUrl: string | null;
  followerCount: number | null;
  approved: boolean | null;
  source: string;
  metadata: Record<string, unknown>;
}

export interface InterestRole {
  roleCode: string;
  source: string;
  metadata: Record<string, unknown>;
}

export interface InterestSubmission {
  id: string;
  submissionType: string;
  normalizedLane: string;
  originalLane: string | null;
  sourceSystem: string;
  sourcePage: string | null;
  status: string;
  payload: unknown;
  submittedAt: string;
}

export interface InterestNote {
  id: string;
  noteContent: string;
  noteType: string;
  isPinned: boolean;
  createdByProfileId: string;
  createdAt: string;
}

export interface InterestOwner {
  profileId: string;
  label: string;
  email: string | null;
}

export interface InterestRecord {
  contact: InterestContact;
  profile: InterestProfile | null;
  roles: InterestRole[];
  socials: InterestSocial[];
  submissions: InterestSubmission[];
  notes: InterestNote[];
  owner: InterestOwner | null;
}

export interface InterestFilters {
  search: string;
  reviewState: string;
  outreachStatus: string;
  role: string;
  state: string;
  veteran: 'all' | (typeof VETERAN_AFFILIATIONS)[number];
  social: 'all' | 'yes' | 'no';
  avatar: 'all' | 'yes' | 'no';
  platform: string;
  owner: string;
  overdue: 'all' | 'yes' | 'no';
  source: string;
  sort: InterestSort;
}

export const DEFAULT_INTEREST_FILTERS: InterestFilters = {
  search: '',
  reviewState: 'all',
  outreachStatus: 'all',
  role: 'all',
  state: 'all',
  veteran: 'all',
  social: 'all',
  avatar: 'all',
  platform: 'all',
  owner: 'all',
  overdue: 'all',
  source: 'all',
  sort: 'newest',
};

export function contactDisplayName(contact: InterestContact): string {
  return contact.preferredName?.trim()
    || [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim()
    || contact.email
    || 'Unnamed contact';
}

function normalizedSearchText(record: InterestRecord): string {
  return [
    contactDisplayName(record.contact),
    record.contact.firstName,
    record.contact.lastName,
    record.contact.email,
    record.profile?.personalMission,
    record.profile?.motivation,
    ...record.socials.flatMap((social) => [social.handle, social.platformName, social.profileUrl]),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

export function isOverdue(record: InterestRecord, now = new Date()): boolean {
  if (!record.contact.nextActionDueAt) return false;
  return new Date(record.contact.nextActionDueAt).getTime() < now.getTime();
}

export function latestInterestSubmission(record: InterestRecord): InterestSubmission | null {
  return record.submissions.reduce<InterestSubmission | null>((latest, submission) => {
    if (!latest || Date.parse(submission.submittedAt) > Date.parse(latest.submittedAt)) return submission;
    return latest;
  }, null);
}

export function latestInterestReceivedAt(record: InterestRecord): string {
  return latestInterestSubmission(record)?.submittedAt ?? record.contact.createdAt;
}

export function recordHasSource(record: InterestRecord, source: string): boolean {
  return record.contact.source === source
    || record.submissions.some((submission) => submission.sourceSystem === source);
}

export function safeExternalHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function isCreatorCommunityInterest(record: InterestRecord): boolean {
  return Boolean(
    record.profile
    || record.roles.some(({ roleCode }) => INTEREST_ROLE_CODES.includes(roleCode as (typeof INTEREST_ROLE_CODES)[number]))
    || record.submissions.some(({ submissionType }) => submissionType === 'interest_submission'),
  );
}

export function filterAndSortInterestRecords(
  records: InterestRecord[],
  filters: InterestFilters,
  now = new Date(),
): InterestRecord[] {
  const search = filters.search.trim().toLocaleLowerCase();
  const filtered = records.filter((record) => {
    const { contact, profile, roles, socials } = record;
    if (!isCreatorCommunityInterest(record)) return false;
    if (search && !normalizedSearchText(record).includes(search)) return false;
    if (filters.reviewState !== 'all' && contact.reviewState !== filters.reviewState) return false;
    if (filters.outreachStatus !== 'all' && contact.outreachStatus !== filters.outreachStatus) return false;
    if (filters.role !== 'all' && !roles.some(({ roleCode }) => roleCode === filters.role)) return false;
    if (filters.state !== 'all' && contact.state !== filters.state) return false;
    if (filters.veteran !== 'all' && contact.veteranAffiliation !== filters.veteran) return false;
    if (filters.social !== 'all' && Boolean(socials.length) !== (filters.social === 'yes')) return false;
    if (filters.avatar !== 'all' && Boolean(profile?.avatarUrl) !== (filters.avatar === 'yes')) return false;
    if (filters.platform !== 'all' && profile?.highestFollowerPlatform !== filters.platform) return false;
    if (filters.owner !== 'all' && (contact.ownerProfileId ?? 'unassigned') !== filters.owner) return false;
    if (filters.overdue !== 'all' && isOverdue(record, now) !== (filters.overdue === 'yes')) return false;
    if (filters.source !== 'all' && !recordHasSource(record, filters.source)) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    switch (filters.sort) {
      case 'oldest_unreviewed': {
        const aReviewed = a.contact.reviewState === 'review_needed' ? 0 : 1;
        const bReviewed = b.contact.reviewState === 'review_needed' ? 0 : 1;
        return aReviewed - bReviewed
          || Date.parse(latestInterestReceivedAt(a)) - Date.parse(latestInterestReceivedAt(b));
      }
      case 'followers':
        return (b.profile?.highestFollowerCount ?? 0) - (a.profile?.highestFollowerCount ?? 0);
      case 'due':
        return (a.contact.nextActionDueAt ? Date.parse(a.contact.nextActionDueAt) : Number.POSITIVE_INFINITY)
          - (b.contact.nextActionDueAt ? Date.parse(b.contact.nextActionDueAt) : Number.POSITIVE_INFINITY);
      case 'name':
        return contactDisplayName(a.contact).localeCompare(contactDisplayName(b.contact));
      case 'newest':
      default:
        return Date.parse(latestInterestReceivedAt(b)) - Date.parse(latestInterestReceivedAt(a));
    }
  });
}

export function formatLabel(value: string | null | undefined): string {
  if (!value) return '\u2014';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function safeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
