-- Newsletter lifecycle contract. Run as a privileged role inside a transaction.
begin;
do $$
begin
  assert private.crm_newsletter_template_preflight('Hi {{last_name}}', null, '', '') like 'DISALLOWED_NEWSLETTER_VARIABLE:last_name%';
  assert private.crm_newsletter_template_preflight('Hi {{foo}}', null, '', '') like 'UNKNOWN_NEWSLETTER_VARIABLE:foo%';
  assert private.crm_newsletter_template_preflight('Hi {{ first name }}', null, '', '') like 'MALFORMED%';
  assert private.crm_newsletter_template_preflight('Hi {{first_name', null, '', '') like 'MALFORMED%';
  assert private.crm_newsletter_template_preflight('Hi {{first_name}}', '{{unsubscribe_url}}', '{{postal_address}}', '{{sender_name}}') is null;
  assert exists (select 1 from pg_constraint where conname='crm_newsletters_status_check' and pg_get_constraintdef(oid) like '%failed%');
  assert (select count(*) from pg_proc where proname='crm_claim_due_newsletters') = 1;
  assert position('''claimed''' in pg_get_functiondef('public.crm_communications_observability'::regproc)) = 0;
  assert position('cron.job j' in pg_get_functiondef('public.crm_newsletter_worker_status'::regproc)) > 0;
end $$;
rollback;
