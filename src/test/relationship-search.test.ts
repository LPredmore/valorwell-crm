import { describe, expect, it } from 'vitest';
import { searchRelationshipDocuments } from '@/services/relationships/search';

const documents = [
  { id: 'organization-1', kind: 'organization' as const, label: 'ValorWell Partners', detail: 'Veteran nonprofit', route: '/crm/business-development/organizations/organization-1', organizationName: 'ValorWell Partners', website: 'valorwell.example', initiative: 'Outreach', ownerName: 'Avery', stage: 'qualified_outreach' },
  { id: 'contact-1', kind: 'contact' as const, label: 'Partnerships inbox', detail: 'Role inbox', route: '/crm/business-development/contacts/contact-1', contactName: 'Partnerships inbox', email: 'partners@example.org', organizationName: 'ValorWell Partners', status: 'active' },
];

describe('relationship search', () => {
  it('searches required relationship fields and returns visibly scoped result records', () => {
    expect(searchRelationshipDocuments(documents, 'avery outreach')).toEqual([{ id: 'organization-1', kind: 'organization', label: 'ValorWell Partners', detail: 'Veteran nonprofit', route: '/crm/business-development/organizations/organization-1' }]);
    expect(searchRelationshipDocuments(documents, 'partners@example.org')).toMatchObject([{ kind: 'contact', label: 'Partnerships inbox' }]);
  });

  it('does not return records for an empty query or unavailable non-relationship source', () => {
    expect(searchRelationshipDocuments(documents, '')).toEqual([]);
    expect(searchRelationshipDocuments(documents, 'clinical client')).toEqual([]);
  });
});
