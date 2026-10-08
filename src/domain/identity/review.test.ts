import { describe, expect, it } from 'vitest';
import type { RelationshipContactRecord } from '@/domain/relationships/records';
import {
  detectDuplicateCandidates, identityPair, linkedRecordUrl, normalizedEmail, normalizedPhone,
} from './review';

const t1 = '00000000-0000-4000-8000-000000000001';
const t2 = '00000000-0000-4000-8000-000000000002';
const c = (id: string, partial: Partial<RelationshipContactRecord> = {}): RelationshipContactRecord => ({
  id, tenantId: t1, kind: 'person', displayName: 'Alex Rivera',
  firstName: 'Alex', lastName: 'Rivera', email: 'alex+work@example.com',
  phone: '816-555-0100', veteranAffiliation: 'unknown', outreachStatus: 'new',
  doNotContact: false, source: 'crm_manual', affiliations: [],
  createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z',
  ...partial,
});

describe('CRM identity review — privacy and merge prevention', () => {
  it('never generates candidates from name-only equality', () => {
    const left = c('a', { email: undefined, phone: undefined });
    const right = c('b', { email: undefined, phone: undefined });
    expect(detectDuplicateCandidates(left, [right])).toEqual([]);
  });
  it('never crosses tenant boundaries even on exact name/email/phone', () => {
    expect(detectDuplicateCandidates(c('a'), [c('b', { tenantId: t2 })])).toEqual([]);
  });
  it('excludes same ID and role inboxes', () => {
    expect(detectDuplicateCandidates(c('a'), [
      c('a'), c('b', { kind: 'role_inbox' }),
    ])).toEqual([]);
  });
  it('flags a shared email with different name for mandatory human review', () => {
    const result = detectDuplicateCandidates(c('a'), [
      c('b', { displayName: 'Morgan Rivera', firstName: 'Morgan', phone: undefined }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ matchBasis: 'email', ambiguous: true });
  });
  it('recognizes matching name + email without auto-approving identity', () => {
    const result = detectDuplicateCandidates(c('a'), [
      c('b', { phone: undefined }),
    ]);
    expect(result[0]).toMatchObject({ matchBasis: 'name_and_email', ambiguous: true });
    // No service call or record mutation exists in this pure discovery function.
  });
  it('matches exact normalized US phone but does not collapse extensions or foreign numbers', () => {
    expect(normalizedPhone('1 (816) 555-0100')).toBe('+18165550100');
    expect(normalizedPhone('816-555-0100 x123')).toBeNull();
    expect(detectDuplicateCandidates(c('a', { email: undefined }), [
      c('b', { email: undefined, phone: '(816) 555-0100' }),
    ])[0].matchBasis).toBe('phone');
  });
  it('does not collapse plus tags or email provider-specific aliases', () => {
    expect(normalizedEmail(' A+work@Example.COM ')).toBe('a+work@example.com');
    expect(normalizedEmail('A@example.com')).not.toBe(normalizedEmail('A+work@example.com'));
  });
  it('uses stable symmetric keys and refuses a client href outside protected route', () => {
    expect(identityPair('z', 'a')).toEqual(['a', 'z']);
    expect(identityPair('a', 'z')).toEqual(['a', 'z']);
    expect(linkedRecordUrl('client', 'c')).toBe('/crm/clients/c');
    expect(linkedRecordUrl('provider_applicant', 'x')).toBeNull();
    expect(linkedRecordUrl('therapist_prospect', 'x')).toBeNull();
  });
});
