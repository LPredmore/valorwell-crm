create or replace function public.newsletter_mailbox_key(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null then null
    when btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then null
    else lower(btrim(p_email))
  end;
$$;

revoke all on function public.newsletter_mailbox_key(text) from public;
grant execute on function public.newsletter_mailbox_key(text) to anon, authenticated, service_role;
