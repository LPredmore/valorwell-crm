import { capabilityState, relationshipCapabilities } from '@/domain/relationships/capabilities';
import type {
  CapabilityAvailability,
  CapabilityStatus,
} from '@/domain/relationships/contracts';
import type {
  RelationshipAffiliationInput,
  RelationshipAffiliationRecord,
  RelationshipAffiliationUpdate,
  RelationshipContactFilters,
  RelationshipContactInput,
  RelationshipContactRecord,
  RelationshipOrganizationFilters,
  RelationshipOrganizationInput,
  RelationshipOrganizationRecord,
  RelationshipOutreachStatus,
  VeteranAffiliation,
} from '@/domain/relationships/records';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { RelationshipsRepository } from '../relationships';
import { unavailableRelationshipsRepository } from '../relationships-unavailable';
import type {
  RelationshipAffiliationInsert,
  RelationshipAffiliationRow,
  RelationshipAffiliationUpdate as RelationshipAffiliationDbUpdate,
  RelationshipContactInsert,
  RelationshipContactRow,
  RelationshipContactUpdate,
  RelationshipOrganizationInsert,
  RelationshipOrganizationRow,
  RelationshipOrganizationUpdate,
} from './relationships-schema';

type OperatingContext = {
  tenantId: string;
  profileId: string;
  crmRole: string;
  canMutate: boolean;
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function isJsonObject(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function capabilityStatusFromError(error: unknown): CapabilityStatus {
  const message = errorMessage(error).toLowerCase();
  if (
    message.includes('permission')
    || message.includes('not authorized')
    || message.includes('row-level security')
    || message.includes('operating tenant')
    || message.includes('authenticated')
    || message.includes('42501')
  ) {
    return 'permission_denied';
  }
  if (message.includes('fetch') || message.includes('network') || message.includes('offline')) {
    return 'network_error';
  }
  if (message.includes('invalid') || message.includes('malformed')) {
    return 'invalid_response';
  }
  return 'query_error';
}

async function operatingContext(): Promise<OperatingContext> {
  const { data, error } = await supabase.rpc('get_crm_operating_context');
  if (error) throw new Error(error.message);
  if (!isJsonObject(data)) throw new Error('Invalid CRM operating context response.');
  if (data.authenticated !== true) throw new Error('Authenticated CRM access is required.');

  const tenantId = data.current_tenant_id;
  const profileId = data.profile_id;
  const crmRole = data.crm_role;
  const capabilities = data.capabilities;

  if (typeof tenantId !== 'string' || !tenantId) {
    throw new Error('No operating tenant is selected for this CRM session.');
  }
  if (typeof profileId !== 'string' || !profileId) {
    throw new Error('Invalid CRM profile context.');
  }
  if (typeof crmRole !== 'string') {
    throw new Error('Invalid CRM role context.');
  }

  return {
    tenantId,
    profileId,
    crmRole,
    canMutate: isJsonObject(capabilities) && capabilities.mutate === true,
  };
}

function requireMutation(context: OperatingContext) {
  if (!context.canMutate) {
    throw new Error('You do not have permission to modify relationship records.');
  }
}

function pageValues(page?: number, pageSize?: number) {
  const resolvedPage = Number.isInteger(page) && (page ?? 0) > 0 ? page! : 1;
  const requestedSize = Number.isInteger(pageSize) && (pageSize ?? 0) > 0
    ? pageSize!
    : DEFAULT_PAGE_SIZE;
  const resolvedSize = Math.min(requestedSize, MAX_PAGE_SIZE);
  const from = (resolvedPage - 1) * resolvedSize;
  return { page: resolvedPage, pageSize: resolvedSize, from, to: from + resolvedSize - 1 };
}

function searchTerm(value?: string) {
  return value?.trim().replace(/[,()%]/g, ' ').replace(/\s+/g, ' ');
}

function optionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toOrganization(row: RelationshipOrganizationRow): RelationshipOrganizationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    website: row.website ?? undefined,
    organizationKind: row.organization_kind ?? undefined,
    veteranAffiliated: row.veteran_affiliated ?? undefined,
    outreachStatus: row.outreach_status as RelationshipOutreachStatus,
    ownerId: row.owner_profile_id ?? undefined,
    nextAction: row.next_action ?? undefined,
    nextActionDueAt: row.next_action_due_at ?? undefined,
    lastContactAt: row.last_contact_at ?? undefined,
    doNotContact: row.do_not_contact,
    source: row.source,
    sourceRecordKey: row.source_record_key ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function organizationInsert(
  tenantId: string,
  input: RelationshipOrganizationInput,
): RelationshipOrganizationInsert {
  const name = input.name.trim();
  if (!name) throw new Error('Organization name is required.');
  return {
    tenant_id: tenantId,
    name,
    website: optionalText(input.website),
    organization_kind: optionalText(input.organizationKind),
    veteran_affiliated: input.veteranAffiliated ?? null,
    outreach_status: input.outreachStatus ?? 'new',
    owner_profile_id: input.ownerId ?? null,
    next_action: optionalText(input.nextAction),
    next_action_due_at: input.nextActionDueAt ?? null,
    do_not_contact: input.doNotContact ?? false,
    source: 'crm_manual',
  };
}

function organizationUpdate(input: Partial<RelationshipOrganizationInput>): RelationshipOrganizationUpdate {
  const patch: RelationshipOrganizationUpdate = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error('Organization name is required.');
    patch.name = name;
  }
  if (input.website !== undefined) patch.website = optionalText(input.website);
  if (input.organizationKind !== undefined) patch.organization_kind = optionalText(input.organizationKind);
  if (input.veteranAffiliated !== undefined) patch.veteran_affiliated = input.veteranAffiliated;
  if (input.outreachStatus !== undefined) patch.outreach_status = input.outreachStatus;
  if (input.ownerId !== undefined) patch.owner_profile_id = input.ownerId || null;
  if (input.nextAction !== undefined) patch.next_action = optionalText(input.nextAction);
  if (input.nextActionDueAt !== undefined) patch.next_action_due_at = input.nextActionDueAt || null;
  if (input.doNotContact !== undefined) patch.do_not_contact = input.doNotContact;
  return patch;
}

function toAffiliation(row: RelationshipAffiliationRow): RelationshipAffiliationRecord {
  return {
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    organizationId: row.organization_id,
    roleTitle: row.role_title ?? undefined,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function affiliationsForContacts(
  tenantId: string,
  contactIds: string[],
): Promise<Map<string, RelationshipAffiliationRecord[]>> {
  const records = new Map<string, RelationshipAffiliationRecord[]>();
  if (!contactIds.length) return records;
  const { data, error } = await supabase
    .from('relationship_contact_organizations')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('contact_id', contactIds)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const affiliation = toAffiliation(row);
    const existing = records.get(row.contact_id) ?? [];
    existing.push(affiliation);
    records.set(row.contact_id, existing);
  }
  return records;
}

function contactDisplayName(row: RelationshipContactRow) {
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return row.preferred_name?.trim() || fullName || row.email || 'Unnamed contact';
}

function toContact(
  row: RelationshipContactRow,
  affiliations: RelationshipAffiliationRecord[],
): RelationshipContactRecord {
  const hasName = Boolean(row.preferred_name || row.first_name || row.last_name);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    profileId: row.profile_id ?? undefined,
    kind: hasName ? 'person' : 'role_inbox',
    displayName: contactDisplayName(row),
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    preferredName: row.preferred_name ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    state: row.state ?? undefined,
    veteranAffiliation: row.veteran_affiliation as VeteranAffiliation,
    outreachStatus: row.outreach_status as RelationshipOutreachStatus,
    ownerId: row.owner_profile_id ?? undefined,
    nextAction: row.next_action ?? undefined,
    nextActionDueAt: row.next_action_due_at ?? undefined,
    lastContactAt: row.last_contact_at ?? undefined,
    doNotContact: row.do_not_contact,
    source: row.source,
    sourceRecordKey: row.source_record_key ?? undefined,
    affiliations,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizedEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('A valid email is required.');
  return email;
}

function contactInsert(tenantId: string, input: RelationshipContactInput): RelationshipContactInsert {
  return {
    tenant_id: tenantId,
    first_name: optionalText(input.firstName),
    last_name: optionalText(input.lastName),
    preferred_name: optionalText(input.preferredName),
    email: normalizedEmail(input.email),
    phone: optionalText(input.phone),
    state: optionalText(input.state),
    veteran_affiliation: input.veteranAffiliation ?? 'unknown',
    outreach_status: input.outreachStatus ?? 'new',
    owner_profile_id: input.ownerId ?? null,
    next_action: optionalText(input.nextAction),
    next_action_due_at: input.nextActionDueAt ?? null,
    do_not_contact: input.doNotContact ?? false,
    source: 'crm_manual',
  };
}

function contactUpdate(input: Partial<RelationshipContactInput>): RelationshipContactUpdate {
  const patch: RelationshipContactUpdate = {};
  if (input.firstName !== undefined) patch.first_name = optionalText(input.firstName);
  if (input.lastName !== undefined) patch.last_name = optionalText(input.lastName);
  if (input.preferredName !== undefined) patch.preferred_name = optionalText(input.preferredName);
  if (input.email !== undefined) patch.email = normalizedEmail(input.email);
  if (input.phone !== undefined) patch.phone = optionalText(input.phone);
  if (input.state !== undefined) patch.state = optionalText(input.state);
  if (input.veteranAffiliation !== undefined) patch.veteran_affiliation = input.veteranAffiliation;
  if (input.outreachStatus !== undefined) patch.outreach_status = input.outreachStatus;
  if (input.ownerId !== undefined) patch.owner_profile_id = input.ownerId || null;
  if (input.nextAction !== undefined) patch.next_action = optionalText(input.nextAction);
  if (input.nextActionDueAt !== undefined) patch.next_action_due_at = input.nextActionDueAt || null;
  if (input.doNotContact !== undefined) patch.do_not_contact = input.doNotContact;
  return patch;
}

async function relationshipCapabilitiesSnapshot(): Promise<CapabilityAvailability[]> {
  try {
    const context = await operatingContext();
    const [organizations, contacts] = await Promise.all([
      supabase
        .from('relationship_organizations')
        .select('id')
        .eq('tenant_id', context.tenantId)
        .limit(1),
      supabase
        .from('relationship_contacts')
        .select('id')
        .eq('tenant_id', context.tenantId)
        .limit(1),
    ]);

    const result = relationshipCapabilities();
    const replace = (record: CapabilityAvailability) => {
      const index = result.findIndex((item) => item.capability === record.capability);
      if (index >= 0) result[index] = record;
    };

    replace(organizations.error
      ? capabilityState('organizations', capabilityStatusFromError(organizations.error), organizations.error.message)
      : capabilityState('organizations', 'available'));
    replace(contacts.error
      ? capabilityState('contacts', capabilityStatusFromError(contacts.error), contacts.error.message)
      : capabilityState('contacts', 'available'));
    return result;
  } catch (error) {
    const status = capabilityStatusFromError(error);
    const diagnostic = errorMessage(error);
    return relationshipCapabilities().map((record) =>
      record.capability === 'organizations' || record.capability === 'contacts'
        ? capabilityState(record.capability, status, diagnostic)
        : record,
    );
  }
}

export const supabaseRelationshipsRepository: RelationshipsRepository = {
  ...unavailableRelationshipsRepository,

  capabilities: relationshipCapabilitiesSnapshot,

  async listOrganizations(filters: RelationshipOrganizationFilters) {
    const context = await operatingContext();
    const paging = pageValues(filters.page, filters.pageSize);
    let query = supabase
      .from('relationship_organizations')
      .select('*', { count: 'exact' })
      .eq('tenant_id', context.tenantId);

    const search = searchTerm(filters.search);
    if (search) query = query.or(`name.ilike.%${search}%,website.ilike.%${search}%`);
    if (filters.outreachStatuses?.length) query = query.in('outreach_status', filters.outreachStatuses);
    if (filters.organizationKinds?.length) query = query.in('organization_kind', filters.organizationKinds);
    if (filters.veteranAffiliated !== undefined) query = query.eq('veteran_affiliated', filters.veteranAffiliated);
    if (filters.ownerIds?.length) query = query.in('owner_profile_id', filters.ownerIds);
    if (filters.doNotContact !== undefined) query = query.eq('do_not_contact', filters.doNotContact);
    if (filters.overdueNextAction) {
      query = query
        .lt('next_action_due_at', new Date().toISOString())
        .not('next_action', 'is', null);
    }
    if (filters.contacted === 'never') query = query.is('last_contact_at', null);
    if (filters.contacted === 'recently') {
      const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('last_contact_at', threshold);
    }

    const sortColumn = filters.sortBy === 'updatedAt'
      ? 'updated_at'
      : filters.sortBy === 'nextActionDueAt'
        ? 'next_action_due_at'
        : 'name';
    query = query
      .order(sortColumn, {
        ascending: filters.sortDirection !== 'desc',
        nullsFirst: false,
      })
      .range(paging.from, paging.to);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return {
      items: (data ?? []).map(toOrganization),
      total: count ?? 0,
      page: paging.page,
      pageSize: paging.pageSize,
    };
  },

  async getOrganization(id) {
    const context = await operatingContext();
    const { data, error } = await supabase
      .from('relationship_organizations')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toOrganization(data) : null;
  },

  async createOrganization(input) {
    const context = await operatingContext();
    requireMutation(context);
    const { data, error } = await supabase
      .from('relationship_organizations')
      .insert(organizationInsert(context.tenantId, input))
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return toOrganization(data);
  },

  async updateOrganization(id, input) {
    const context = await operatingContext();
    requireMutation(context);
    const { data, error } = await supabase
      .from('relationship_organizations')
      .update(organizationUpdate(input))
      .eq('tenant_id', context.tenantId)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Relationship organization not found.');
    return toOrganization(data);
  },

  async listContacts(filters: RelationshipContactFilters) {
    const context = await operatingContext();
    const paging = pageValues(filters.page, filters.pageSize);
    let restrictedContactIds: string[] | undefined;

    if (filters.organizationIds?.length) {
      const affiliations = await supabase
        .from('relationship_contact_organizations')
        .select('contact_id')
        .eq('tenant_id', context.tenantId)
        .in('organization_id', filters.organizationIds);
      if (affiliations.error) throw new Error(affiliations.error.message);
      restrictedContactIds = [...new Set((affiliations.data ?? []).map((row) => row.contact_id))];
      if (!restrictedContactIds.length) {
        return { items: [], total: 0, page: paging.page, pageSize: paging.pageSize };
      }
    }

    let query = supabase
      .from('relationship_contacts')
      .select('*', { count: 'exact' })
      .eq('tenant_id', context.tenantId);

    if (restrictedContactIds) query = query.in('id', restrictedContactIds);
    const search = searchTerm(filters.search);
    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,preferred_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`,
      );
    }
    if (filters.ownerIds?.length) query = query.in('owner_profile_id', filters.ownerIds);
    if (filters.outreachStatuses?.length) query = query.in('outreach_status', filters.outreachStatuses);
    if (filters.veteranAffiliations?.length) query = query.in('veteran_affiliation', filters.veteranAffiliations);
    if (filters.doNotContact !== undefined) query = query.eq('do_not_contact', filters.doNotContact);
    if (filters.hasNextAction === true) query = query.not('next_action', 'is', null);
    if (filters.hasNextAction === false) query = query.is('next_action', null);

    if (filters.sortBy === 'updatedAt') {
      query = query.order('updated_at', { ascending: filters.sortDirection !== 'desc' });
    } else if (filters.sortBy === 'nextActionDueAt') {
      query = query.order('next_action_due_at', {
        ascending: filters.sortDirection !== 'desc',
        nullsFirst: false,
      });
    } else {
      query = query
        .order('preferred_name', { ascending: filters.sortDirection !== 'desc', nullsFirst: false })
        .order('last_name', { ascending: filters.sortDirection !== 'desc', nullsFirst: false })
        .order('email', { ascending: filters.sortDirection !== 'desc', nullsFirst: false });
    }

    const { data, error, count } = await query.range(paging.from, paging.to);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const affiliationMap = await affiliationsForContacts(
      context.tenantId,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((row) => toContact(row, affiliationMap.get(row.id) ?? [])),
      total: count ?? 0,
      page: paging.page,
      pageSize: paging.pageSize,
    };
  },

  async getContact(id) {
    const context = await operatingContext();
    const { data, error } = await supabase
      .from('relationship_contacts')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const affiliations = await affiliationsForContacts(context.tenantId, [data.id]);
    return toContact(data, affiliations.get(data.id) ?? []);
  },

  async createContact(input) {
    const context = await operatingContext();
    requireMutation(context);
    const { data, error } = await supabase
      .from('relationship_contacts')
      .insert(contactInsert(context.tenantId, input))
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return toContact(data, []);
  },

  async updateContact(id, input) {
    const context = await operatingContext();
    requireMutation(context);
    const { data, error } = await supabase
      .from('relationship_contacts')
      .update(contactUpdate(input))
      .eq('tenant_id', context.tenantId)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Relationship contact not found.');
    const affiliations = await affiliationsForContacts(context.tenantId, [data.id]);
    return toContact(data, affiliations.get(data.id) ?? []);
  },

  async listAffiliations(subject) {
    const context = await operatingContext();
    if (!subject.contactId && !subject.organizationId) {
      throw new Error('An organization or contact is required to list affiliations.');
    }
    let query = supabase
      .from('relationship_contact_organizations')
      .select('*')
      .eq('tenant_id', context.tenantId);
    if (subject.contactId) query = query.eq('contact_id', subject.contactId);
    if (subject.organizationId) query = query.eq('organization_id', subject.organizationId);
    const { data, error } = await query
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toAffiliation);
  },

  async createAffiliation(input: RelationshipAffiliationInput) {
    const context = await operatingContext();
    requireMutation(context);
    const row: RelationshipAffiliationInsert = {
      tenant_id: context.tenantId,
      contact_id: input.contactId,
      organization_id: input.organizationId,
      role_title: optionalText(input.roleTitle),
      is_primary: input.isPrimary ?? false,
    };
    const { data, error } = await supabase
      .from('relationship_contact_organizations')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return toAffiliation(data);
  },

  async updateAffiliation(key, input: RelationshipAffiliationUpdate) {
    const context = await operatingContext();
    requireMutation(context);
    const patch: RelationshipAffiliationDbUpdate = {};
    if (input.roleTitle !== undefined) patch.role_title = optionalText(input.roleTitle);
    if (input.isPrimary !== undefined) patch.is_primary = input.isPrimary;
    const { data, error } = await supabase
      .from('relationship_contact_organizations')
      .update(patch)
      .eq('tenant_id', context.tenantId)
      .eq('contact_id', key.contactId)
      .eq('organization_id', key.organizationId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Relationship affiliation not found.');
    return toAffiliation(data);
  },
};
