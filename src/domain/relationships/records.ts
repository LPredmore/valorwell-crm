import type {
  AuditMetadata,
  ContactKind,
  PageResult,
  RelationshipStage,
  SortDirection,
} from './contracts';

export const relationshipOutreachStatuses = [
  'new',
  'reviewing',
  'contacted',
  'engaged',
  'waiting',
  'closed',
  'do_not_contact',
] as const;

export type RelationshipOutreachStatus =
  (typeof relationshipOutreachStatuses)[number];

export const veteranAffiliationValues = [
  'unknown',
  'veteran',
  'family_member',
  'military_connected',
  'none',
] as const;

export type VeteranAffiliation =
  (typeof veteranAffiliationValues)[number];

export type RelationshipOrganizationRecord = AuditMetadata & {
  id: string;
  tenantId: string;
  name: string;
  website?: string;
  organizationKind?: string;
  veteranAffiliated?: boolean;
  stage: RelationshipStage;
  outreachStatus: RelationshipOutreachStatus;
  ownerId?: string;
  nextAction?: string;
  nextActionDueAt?: string;
  lastContactAt?: string;
  doNotContact: boolean;
  source: string;
  sourceRecordKey?: string;
};

export type RelationshipOrganizationInput = {
  name: string;
  website?: string;
  organizationKind?: string;
  veteranAffiliated?: boolean;
  outreachStatus?: RelationshipOutreachStatus;
  ownerId?: string;
  nextAction?: string;
  nextActionDueAt?: string;
  doNotContact?: boolean;
};

export type RelationshipOrganizationFilters = {
  search?: string;
  outreachStatuses?: RelationshipOutreachStatus[];
  organizationKinds?: string[];
  veteranAffiliated?: boolean;
  ownerIds?: string[];
  overdueNextAction?: boolean;
  doNotContact?: boolean;
  contacted?: 'recently' | 'never';
  page?: number;
  pageSize?: number;
  sortBy?: 'name' | 'updatedAt' | 'nextActionDueAt';
  sortDirection?: SortDirection;
};

export type RelationshipAffiliationKey = {
  tenantId: string;
  contactId: string;
  organizationId: string;
};

export type RelationshipAffiliationRecord = AuditMetadata &
  RelationshipAffiliationKey & {
    roleTitle?: string;
    isPrimary: boolean;
  };

export type RelationshipAffiliationInput = {
  contactId: string;
  organizationId: string;
  roleTitle?: string;
  isPrimary?: boolean;
};

export type RelationshipAffiliationUpdate = {
  roleTitle?: string;
  isPrimary?: boolean;
};

export type RelationshipContactRecord = AuditMetadata & {
  id: string;
  tenantId: string;
  profileId?: string;
  kind: ContactKind;
  displayName: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  email?: string;
  phone?: string;
  state?: string;
  veteranAffiliation: VeteranAffiliation;
  stage: RelationshipStage;
  outreachStatus: RelationshipOutreachStatus;
  ownerId?: string;
  nextAction?: string;
  nextActionDueAt?: string;
  lastContactAt?: string;
  doNotContact: boolean;
  source: string;
  sourceRecordKey?: string;
  affiliations: RelationshipAffiliationRecord[];
};

/** Manual CRM contact creation requires an email. Import/source-key-only records
 * remain part of the later import capability, not this first slice. */
export type RelationshipContactInput = {
  email: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  phone?: string;
  state?: string;
  veteranAffiliation?: VeteranAffiliation;
  outreachStatus?: RelationshipOutreachStatus;
  ownerId?: string;
  nextAction?: string;
  nextActionDueAt?: string;
  doNotContact?: boolean;
};

export type RelationshipContactFilters = {
  search?: string;
  organizationIds?: string[];
  ownerIds?: string[];
  outreachStatuses?: RelationshipOutreachStatus[];
  veteranAffiliations?: VeteranAffiliation[];
  doNotContact?: boolean;
  hasNextAction?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: 'displayName' | 'updatedAt' | 'nextActionDueAt';
  sortDirection?: SortDirection;
};

export type RelationshipOrganizationPage =
  PageResult<RelationshipOrganizationRecord>;
export type RelationshipContactPage = PageResult<RelationshipContactRecord>;
