import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import {
  type InterestContact,
  type InterestNote,
  type InterestOwner,
  type InterestProfile,
  type InterestRecord,
  type InterestRole,
  type InterestSocial,
  type InterestSubmission,
  INTEREST_ROLE_CODES,
  isInterestRoleCode,
  safeMetadata,
} from '@/lib/crm/creator-community-interest';

const QUERY_KEY = 'creator-community-interest';
export const CREATOR_INTEREST_CONFLICT_FEED_LIMIT = 25;

const QUEUE_PROFILE_COLUMNS = [
  'contact_id',
  'motivation',
  'veteran_connection',
  'highest_follower_platform',
  'highest_follower_count',
  'personal_mission',
  'avatar_url',
].join(', ');
const QUEUE_CONTACT_COLUMNS = [
  'id',
  'tenant_id',
  'first_name',
  'last_name',
  'preferred_name',
  'email',
  'phone',
  'state',
  'veteran_affiliation',
  'outreach_status',
  'review_state',
  'owner_profile_id',
  'next_action',
  'next_action_due_at',
  'do_not_contact',
  'source',
  'created_at',
  'updated_at',
].join(', ');
const QUEUE_ROLE_COLUMNS = 'contact_id, role_code, source';
const QUEUE_SOCIAL_COLUMNS = 'id, contact_id, platform_name, handle, profile_url, follower_count, approved';

interface ContactRow {
  id: string;
  tenant_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  veteran_affiliation: string;
  outreach_status: string;
  review_state?: string | null;
  owner_profile_id: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  last_contact_at?: string | null;
  do_not_contact: boolean;
  source: string;
  source_record_key?: string | null;
  metadata?: unknown;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  contact_id: string;
  motivation?: string | null;
  veteran_connection?: string | null;
  willing_to_share?: boolean | null;
  comfort_level?: string | null;
  fundraising_goal?: string | null;
  additional_info?: string | null;
  accepted_rules?: boolean | null;
  highest_follower_platform?: string | null;
  highest_follower_count?: number | null;
  personal_mission?: string | null;
  avatar_url?: string | null;
  profile_complete?: boolean | null;
  past_competitions?: unknown;
  is_competing?: boolean;
  status?: string;
  source?: string;
  source_record_key?: string | null;
  metadata?: unknown;
}

interface RoleRow { contact_id: string; role_code: string; source?: string; metadata?: unknown }
interface SocialRow { id: string; contact_id: string | null; platform_name: string; handle: string | null; profile_url: string | null; follower_count: number | null; approved: boolean | null; source?: string; metadata?: unknown }
interface SubmissionRow { id: string; contact_id: string | null; subject_contact_id: string | null; submission_type: string; normalized_lane: string; original_lane: string | null; source_system: string; source_page: string | null; status: string; payload?: unknown; submitted_at: string }
interface NoteRow { id: string; relationship_contact_id?: string | null; note_content: string; note_type: string; is_pinned: boolean; created_by_profile_id: string; created_at: string }
interface StaffRow { profile_id: string; prov_name_f: string | null; prov_name_l: string | null; prov_name_for_clients: string | null; profiles: { id: string; email: string } | { id: string; email: string }[] | null }
interface ConflictRow { id: string; source_record_key: string; status: string; source_page: string | null; payload: unknown; submitted_at: string }

function mapContact(row: ContactRow): InterestContact {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    firstName: row.first_name,
    lastName: row.last_name,
    preferredName: row.preferred_name,
    email: row.email,
    phone: row.phone,
    state: row.state,
    veteranAffiliation: row.veteran_affiliation,
    outreachStatus: row.outreach_status,
    reviewState: row.review_state ?? 'review_needed',
    ownerProfileId: row.owner_profile_id,
    nextAction: row.next_action,
    nextActionDueAt: row.next_action_due_at,
    lastContactAt: row.last_contact_at ?? null,
    doNotContact: row.do_not_contact,
    source: row.source,
    sourceRecordKey: row.source_record_key ?? null,
    metadata: safeMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProfile(row: ProfileRow): InterestProfile {
  return {
    contactId: row.contact_id,
    motivation: row.motivation ?? null,
    veteranConnection: row.veteran_connection ?? null,
    willingToShare: row.willing_to_share ?? null,
    comfortLevel: row.comfort_level ?? null,
    fundraisingGoal: row.fundraising_goal ?? null,
    additionalInfo: row.additional_info ?? null,
    acceptedRules: row.accepted_rules ?? null,
    highestFollowerPlatform: row.highest_follower_platform ?? null,
    highestFollowerCount: row.highest_follower_count ?? null,
    personalMission: row.personal_mission ?? null,
    avatarUrl: row.avatar_url ?? null,
    profileComplete: row.profile_complete ?? null,
    pastCompetitions: row.past_competitions ?? null,
    isCompeting: row.is_competing ?? false,
    status: row.status ?? '',
    source: row.source ?? '',
    sourceRecordKey: row.source_record_key ?? null,
    metadata: safeMetadata(row.metadata),
  };
}

function mapOwner(row: StaffRow): InterestOwner {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    profileId: row.profile_id,
    label: row.prov_name_for_clients?.trim()
      || [row.prov_name_f, row.prov_name_l].filter(Boolean).join(' ').trim()
      || profile?.email
      || 'Staff member',
    email: profile?.email ?? null,
  };
}

function throwIfError(error: { message: string } | null, safeMessage: string): void {
  if (error) throw new Error(safeMessage);
}

async function loadOwners(tenantId: string): Promise<InterestOwner[]> {
  const { data, error } = await supabase
    .from('staff')
    .select('profile_id, prov_name_f, prov_name_l, prov_name_for_clients, profiles!staff_profile_id_fkey(id, email)')
    .eq('tenant_id', tenantId)
    .order('prov_name_l', { ascending: true, nullsFirst: false });
  throwIfError(error, 'Unable to load available owners.');
  return ((data ?? []) as unknown as StaffRow[]).map(mapOwner);
}

async function loadRecords(tenantId: string): Promise<{ records: InterestRecord[]; owners: InterestOwner[]; conflicts: ConflictRow[] }> {
  const [profilesResult, interestRoleResult, submissionsResult, conflictsResult, owners] = await Promise.all([
    supabase.from('relationship_influencer_profiles').select(QUEUE_PROFILE_COLUMNS).eq('tenant_id', tenantId),
    supabase.from('relationship_contact_roles').select('contact_id, role_code').eq('tenant_id', tenantId).in('role_code', INTEREST_ROLE_CODES),
    supabase.from('website_submissions')
      .select('id, contact_id, subject_contact_id, submission_type, normalized_lane, original_lane, source_system, source_page, status, submitted_at')
      .eq('tenant_id', tenantId)
      .eq('submission_type', 'interest_submission'),
    supabase.from('relationship_interest_submission_conflicts' as never)
      .select('id, source_record_key, status, source_page, payload, submitted_at')
      .eq('tenant_id', tenantId)
      .order('submitted_at', { ascending: false })
      .limit(CREATOR_INTEREST_CONFLICT_FEED_LIMIT),
    loadOwners(tenantId),
  ]);
  for (const result of [profilesResult, interestRoleResult, submissionsResult, conflictsResult]) {
    throwIfError(result.error, 'Unable to load the creator interest queue.');
  }

  const profiles = (profilesResult.data ?? []) as unknown as ProfileRow[];
  const interestRoles = (interestRoleResult.data ?? []) as unknown as RoleRow[];
  const submissions = (submissionsResult.data ?? []) as unknown as SubmissionRow[];
  const contactIds = Array.from(new Set([
    ...profiles.map(({ contact_id }) => contact_id),
    ...interestRoles.map(({ contact_id }) => contact_id),
    ...submissions.flatMap(({ contact_id, subject_contact_id }) => [contact_id, subject_contact_id].filter((id): id is string => Boolean(id))),
  ]));

  const conflicts = (conflictsResult.data ?? []) as unknown as ConflictRow[];
  if (contactIds.length === 0) return { records: [], owners, conflicts };

  const [contactsResult, rolesResult, socialsResult] = await Promise.all([
    supabase.from('relationship_contacts').select(QUEUE_CONTACT_COLUMNS).eq('tenant_id', tenantId).in('id', contactIds),
    supabase.from('relationship_contact_roles').select(QUEUE_ROLE_COLUMNS).eq('tenant_id', tenantId).in('contact_id', contactIds),
    supabase.from('relationship_social_profiles').select(QUEUE_SOCIAL_COLUMNS).eq('tenant_id', tenantId).in('contact_id', contactIds),
  ]);
  for (const result of [contactsResult, rolesResult, socialsResult]) {
    throwIfError(result.error, 'Unable to load the creator interest queue.');
  }

  const roles = (rolesResult.data ?? []) as unknown as RoleRow[];
  const socials = (socialsResult.data ?? []) as unknown as SocialRow[];
  const ownerById = new Map(owners.map((owner) => [owner.profileId, owner]));

  return {
    owners,
    conflicts,
    records: ((contactsResult.data ?? []) as unknown as ContactRow[]).map((row) => {
      const contact = mapContact(row);
      return {
        contact,
        profile: profiles.find((profile) => profile.contact_id === contact.id)
          ? mapProfile(profiles.find((profile) => profile.contact_id === contact.id) as ProfileRow)
          : null,
        roles: roles.filter((role) => role.contact_id === contact.id).map((role): InterestRole => ({
          roleCode: role.role_code,
          source: role.source ?? '',
          metadata: safeMetadata(role.metadata),
        })),
        socials: socials.filter((social) => social.contact_id === contact.id).map((social): InterestSocial => ({
          id: social.id,
          platformName: social.platform_name,
          handle: social.handle,
          profileUrl: social.profile_url,
          followerCount: social.follower_count,
          approved: social.approved,
          source: social.source ?? '',
          metadata: safeMetadata(social.metadata),
        })),
        submissions: submissions.filter((submission) => submission.contact_id === contact.id || submission.subject_contact_id === contact.id).map((submission): InterestSubmission => ({
          id: submission.id,
          submissionType: submission.submission_type,
          normalizedLane: submission.normalized_lane,
          originalLane: submission.original_lane,
          sourceSystem: submission.source_system,
          sourcePage: submission.source_page,
          status: submission.status,
          payload: submission.payload ?? null,
          submittedAt: submission.submitted_at,
        })),
        notes: [],
        owner: contact.ownerProfileId ? ownerById.get(contact.ownerProfileId) ?? null : null,
      };
    }),
  };
}

async function loadRecord(tenantId: string, contactId: string): Promise<{ record: InterestRecord | null; owners: InterestOwner[] }> {
  const [contactResult, profileResult, rolesResult, socialsResult, submissionsResult, notesResult, owners] = await Promise.all([
    supabase.from('relationship_contacts').select('*').eq('tenant_id', tenantId).eq('id', contactId).maybeSingle(),
    supabase.from('relationship_influencer_profiles').select('*').eq('tenant_id', tenantId).eq('contact_id', contactId).maybeSingle(),
    supabase.from('relationship_contact_roles').select('*').eq('tenant_id', tenantId).eq('contact_id', contactId),
    supabase.from('relationship_social_profiles').select('*').eq('tenant_id', tenantId).eq('contact_id', contactId),
    supabase.from('website_submissions').select('*').eq('tenant_id', tenantId).or(`contact_id.eq.${contactId},subject_contact_id.eq.${contactId}`).order('submitted_at', { ascending: false }),
    supabase.from('crm_notes').select('*').eq('tenant_id', tenantId).eq('relationship_contact_id' as never, contactId).order('created_at', { ascending: false }),
    loadOwners(tenantId),
  ]);
  for (const result of [contactResult, profileResult, rolesResult, socialsResult, submissionsResult, notesResult]) {
    throwIfError(result.error, 'Unable to load this creator interest record.');
  }
  if (!contactResult.data) return { record: null, owners };

  const contact = mapContact(contactResult.data as unknown as ContactRow);
  const ownerById = new Map(owners.map((owner) => [owner.profileId, owner]));
  return {
    owners,
    record: {
      contact,
      profile: profileResult.data ? mapProfile(profileResult.data as unknown as ProfileRow) : null,
      roles: ((rolesResult.data ?? []) as unknown as RoleRow[]).map((role) => ({ roleCode: role.role_code, source: role.source ?? '', metadata: safeMetadata(role.metadata) })),
      socials: ((socialsResult.data ?? []) as unknown as SocialRow[]).map((social) => ({ id: social.id, platformName: social.platform_name, handle: social.handle, profileUrl: social.profile_url, followerCount: social.follower_count, approved: social.approved, source: social.source ?? '', metadata: safeMetadata(social.metadata) })),
      submissions: ((submissionsResult.data ?? []) as unknown as SubmissionRow[]).map((submission) => ({ id: submission.id, submissionType: submission.submission_type, normalizedLane: submission.normalized_lane, originalLane: submission.original_lane, sourceSystem: submission.source_system, sourcePage: submission.source_page, status: submission.status, payload: submission.payload, submittedAt: submission.submitted_at })),
      notes: ((notesResult.data ?? []) as unknown as NoteRow[]).map((note): InterestNote => ({ id: note.id, noteContent: note.note_content, noteType: note.note_type, isPinned: note.is_pinned, createdByProfileId: note.created_by_profile_id, createdAt: note.created_at })),
      owner: contact.ownerProfileId ? ownerById.get(contact.ownerProfileId) ?? null : null,
    },
  };
}

export function useCreatorCommunityInterestQueue() {
  const { tenantId, isAuthenticated } = useCrmAuth();
  return useQuery({
    queryKey: [QUERY_KEY, tenantId, 'queue'],
    queryFn: () => loadRecords(tenantId),
    enabled: isAuthenticated && Boolean(tenantId),
  });
}

export function useCreatorCommunityInterestDetail(contactId: string | undefined) {
  const { tenantId, isAuthenticated } = useCrmAuth();
  return useQuery({
    queryKey: [QUERY_KEY, tenantId, 'detail', contactId],
    queryFn: () => loadRecord(tenantId, contactId as string),
    enabled: isAuthenticated && Boolean(tenantId && contactId),
  });
}

export interface ContactCorrection {
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
  email?: string | null;
  phone?: string | null;
  state?: string | null;
  veteran_affiliation?: string;
  owner_profile_id?: string | null;
  outreach_status?: string;
  review_state?: string;
  next_action?: string | null;
  next_action_due_at?: string | null;
  do_not_contact?: boolean;
}

export interface ProfileCorrection {
  motivation?: string | null;
  veteran_connection?: string | null;
  willing_to_share?: boolean | null;
  comfort_level?: string | null;
  fundraising_goal?: string | null;
  additional_info?: string | null;
  personal_mission?: string | null;
}

export interface InterestRecordCorrection {
  contactChanges: ContactCorrection;
  profileChanges?: ProfileCorrection;
}

export function useInterestMutations(contactId: string) {
  const queryClient = useQueryClient();
  const { tenantId, userId, capabilities } = useCrmAuth();
  const requireMutationContext = () => {
    if (!tenantId || !userId || !capabilities.mutate) throw new Error('You do not have permission to update this record.');
  };
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: [QUERY_KEY, tenantId] });
  };

  const updateRecord = useMutation({
    mutationFn: async ({ contactChanges, profileChanges = {} }: InterestRecordCorrection) => {
      requireMutationContext();
      const { data, error } = await supabase.rpc('update_creator_interest_record' as never, {
        p_tenant_id: tenantId,
        p_contact_id: contactId,
        p_contact_changes: contactChanges,
        p_profile_changes: profileChanges,
      } as never);
      throwIfError(error, 'Unable to update this interest record.');
      const result = data as unknown as { ok?: unknown } | null;
      if (result?.ok !== true) {
        throw new Error('Unable to update this interest record.');
      }
    },
    onSuccess: invalidate,
  });

  const addRole = useMutation({
    mutationFn: async (roleCode: string) => {
      requireMutationContext();
      if (!isInterestRoleCode(roleCode)) throw new Error('This role cannot be changed from the interest workflow.');
      const { data, error } = await supabase.from('relationship_contact_roles')
        .upsert({ tenant_id: tenantId, contact_id: contactId, role_code: roleCode, source: 'crm_staff' }, { onConflict: 'contact_id,role_code' })
        .select('contact_id')
        .maybeSingle();
      throwIfError(error, 'Unable to add this role.');
      if (!data) throw new Error('Unable to add this role.');
    },
    onSuccess: invalidate,
  });

  const removeRole = useMutation({
    mutationFn: async (roleCode: string) => {
      requireMutationContext();
      if (!isInterestRoleCode(roleCode)) throw new Error('This role cannot be changed from the interest workflow.');
      const { data, error } = await supabase.from('relationship_contact_roles')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('contact_id', contactId)
        .eq('role_code', roleCode)
        .select('contact_id')
        .maybeSingle();
      throwIfError(error, 'Unable to remove this role.');
      if (!data) throw new Error('Unable to remove this role.');
    },
    onSuccess: invalidate,
  });

  const addNote = useMutation({
    mutationFn: async (noteContent: string) => {
      requireMutationContext();
      const content = noteContent.trim();
      if (!content) throw new Error('Note cannot be empty.');
      const { data, error } = await supabase.from('crm_notes').insert({
        tenant_id: tenantId,
        relationship_contact_id: contactId,
        created_by_profile_id: userId,
        note_content: content,
        note_type: 'internal',
      } as never).select('id').maybeSingle();
      throwIfError(error, 'Unable to add this note.');
      if (!data) throw new Error('Unable to add this note.');
    },
    onSuccess: invalidate,
  });

  return { canMutate: capabilities.mutate, updateRecord, addRole, removeRole, addNote };
}
