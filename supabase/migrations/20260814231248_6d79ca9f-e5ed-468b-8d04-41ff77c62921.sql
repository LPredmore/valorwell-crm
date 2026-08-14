alter table public.crm_email_templates drop constraint if exists crm_email_templates_scope_check;
alter table public.crm_email_templates add constraint crm_email_templates_scope_check
  check (content_scope = any (array['client','relationship','staff','marketing_newsletter']));

alter table public.crm_email_template_versions drop constraint if exists crm_email_template_versions_scope_check;
alter table public.crm_email_template_versions add constraint crm_email_template_versions_scope_check
  check (content_scope = any (array['client','relationship','staff','marketing_newsletter']));