-- Legacy transactions have no reviewed source-to-tenant ownership contract.
-- The original owner-executed view bypasses crm_donors RLS and can disclose
-- another tenant's donor/transaction identifiers to any authenticated user.
-- Fail closed at this view boundary; keep tenant-scoped crm_donors SELECT and
-- existing trusted service consumers intact. Do not infer ownership from email
-- or a provider contact ID, and do not invoke or alter the legacy processor.
begin;
revoke all on public.crm_donor_transactions_v from public, anon, authenticated;
comment on view public.crm_donor_transactions_v is
  'Legacy service-only read model. Browser access withheld pending reviewed provider-source tenant ownership; do not restore with an email-derived mapping.';
commit;
