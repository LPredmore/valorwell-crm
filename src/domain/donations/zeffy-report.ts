import { z } from 'zod';

const integerText = z.string().regex(/^(0|[1-9][0-9]*)$/).max(30);
const currencyRow = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  sourceType: z.enum(['online', 'manual', 'imported']),
  paymentsRecorded: integerText, completedPayments: integerText,
  grossCents: integerText, refundedCents: integerText, netCents: integerText,
  websiteCandidates: integerText, requiresReview: integerText,
}).strict().superRefine((row, ctx) => {
  if (![row.refundedCents, row.grossCents, row.netCents, row.completedPayments, row.paymentsRecorded, row.websiteCandidates, row.requiresReview].every(value => /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 30)) return;
  if (BigInt(row.refundedCents) > BigInt(row.grossCents)
    || BigInt(row.netCents) !== BigInt(row.grossCents) - BigInt(row.refundedCents)
    || BigInt(row.completedPayments) > BigInt(row.paymentsRecorded)
    || BigInt(row.websiteCandidates) > BigInt(row.completedPayments)
    || BigInt(row.requiresReview) > BigInt(row.paymentsRecorded)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent payment aggregate.' });
  }
});
const schema = z.object({
  contractVersion: z.literal('zeffy-donation-summary.v1'),
  tenantId: z.string().uuid(), coverage: z.literal('reconciled_payments_only'),
  attribution: z.literal('not_established'),
  sources: z.array(z.object({ sourceAccountId: z.string().uuid(), campaignId: z.string().uuid(),
    organizationId: z.string().uuid(), enabled: z.boolean() }).strict()).max(100),
  currencies: z.array(currencyRow).max(300), pendingPayments: integerText,
  lastObservedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type ZeffyDonationReport = z.infer<typeof schema>;
export function parseZeffyDonationReport(value: unknown, tenantId: string): ZeffyDonationReport {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data.tenantId !== tenantId) throw new Error('Zeffy report contract is unavailable for the selected tenant.');
  const report = parsed.data;
  if (new Set(report.sources.map(source => source.sourceAccountId)).size !== report.sources.length
    || new Set(report.currencies.map(row => `${row.currency}:${row.sourceType}`)).size !== report.currencies.length
    || (!report.sources.length && (report.currencies.length || report.pendingPayments !== '0' || report.lastObservedAt !== null))) {
    throw new Error('Zeffy report contains inconsistent source coverage.');
  }
  return report;
}

/** Provider documents cents; no floating-point conversion or currency mixing. */
export function formatZeffyCents(cents: string, currency: string, locale?: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(cents) || !/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid displayed amount.');
  const value = BigInt(cents);
  return `${currency} ${(value / 100n).toLocaleString(locale)}.${(value % 100n).toString().padStart(2, '0')}`;
}
