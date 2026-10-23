-- READ-ONLY predeploy contract check for relationship-gmail-push and
-- relationship-google-maintenance. Run against production before deploying
-- either function. Every row must report ok = true; any false blocks deploy.
with required(sig, server_only) as (values
  ('public.record_relationship_gmail_source_receipt(uuid,text,text,text,jsonb,jsonb)', true),
  ('public.record_relationship_gmail_retrieval_failure(text,text)', true),
  ('private.relationship_has_exact_gmail_source(uuid,text,uuid)', true),
  ('private.relationship_email_source_recovery(uuid)', true),
  ('public.get_relationship_email_source_recovery()', false),
  ('public.get_relationship_gmail_diagnostics()', false)
)
select r.sig,
  to_regprocedure(r.sig) is not null
  and not has_function_privilege('anon', to_regprocedure(r.sig), 'execute')
  and (not r.server_only or not has_function_privilege('authenticated', to_regprocedure(r.sig), 'execute'))
  and has_function_privilege('service_role', to_regprocedure(r.sig), 'execute') as ok
from required r
union all
select 'private.relationship_gmail_source_receipts',
  to_regclass('private.relationship_gmail_source_receipts') is not null
  and not has_table_privilege('authenticated', 'private.relationship_gmail_source_receipts', 'select')
  and not has_table_privilege('anon', 'private.relationship_gmail_source_receipts', 'select');
