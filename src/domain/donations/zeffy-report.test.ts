// Prepared only; execution deferred to Todoist task 42.
import { describe, expect, it } from 'vitest';
import { formatZeffyCents, parseZeffyDonationReport } from './zeffy-report';
const tenantId = '00000000-0000-0000-0000-000000000001';
const row = { currency: 'USD', sourceType: 'online', paymentsRecorded: '1', completedPayments: '1',
  grossCents: '7500', refundedCents: '2500', netCents: '5000', websiteCandidates: '1', requiresReview: '0' };
const report = () => ({ contractVersion: 'zeffy-donation-summary.v1', tenantId, coverage: 'reconciled_payments_only',
  attribution: 'not_established', sources: [{ sourceAccountId: '82c94ff3-79c1-44a0-ab32-7c984ec4aec4',
    organizationId: '82c94ff3-79c1-44a0-ab32-7c984ec4aec4', campaignId: 'd46f040c-7dcb-4d71-9954-9238f4e43e22', enabled: false }],
  currencies: [row], pendingPayments: '0', lastObservedAt: '2026-10-15T12:00:00+00:00' });
describe('Zeffy financial report boundary', () => {
  it('rejects foreign scope, duplicate groups, malformed amounts and inconsistent refunds', () => {
    expect(() => parseZeffyDonationReport(report(), 'other')).toThrow(/contract/);
    expect(() => parseZeffyDonationReport({ ...report(), currencies: [row, row] }, tenantId)).toThrow(/coverage/);
    for (const changes of [{ netCents: '7500' }, { refundedCents: '8000' }, { grossCents: 'not-money' }]) {
      expect(() => parseZeffyDonationReport({ ...report(), currencies: [{ ...row, ...changes }] }, tenantId)).toThrow();
    }
  });
  it('preserves large cent strings without floating-point rounding or currency mixing', () => {
    expect(formatZeffyCents('900719925474099199', 'USD', 'en-US')).toBe('USD 9,007,199,254,740,991.99');
    expect(parseZeffyDonationReport(report(), tenantId).currencies[0].netCents).toBe('5000');
  });
  it('permits a configured empty known set but rejects money without a configured source', () => {
    expect(parseZeffyDonationReport({ ...report(), currencies: [], lastObservedAt: null }, tenantId).currencies).toEqual([]);
    expect(() => parseZeffyDonationReport({ ...report(), sources: [] }, tenantId)).toThrow(/coverage/);
  });
});
