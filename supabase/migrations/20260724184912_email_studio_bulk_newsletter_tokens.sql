-- Email Studio Pass 9: stable private hash-only unsubscribe tokens.

create or replace function public.crm_issue_client_unsubscribe_token(
  p_tenant_id uuid,
  p_bulk_send_id uuid,
  p_recipient_id uuid,
  p_client_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_token text := p_recipient_id::text;
begin
  if not exists (
    select 1
    from public.crm_bulk_send_recipients recipient
    join public.crm_bulk_send_logs job on job.id = recipient.bulk_send_id and job.tenant_id = recipient.tenant_id
    where recipient.id = p_recipient_id and recipient.tenant_id = p_tenant_id
      and recipient.bulk_send_id = p_bulk_send_id and recipient.client_id = p_client_id
      and job.recipient_type = 'client' and job.content_mode = 'newsletter'
  ) then raise exception 'Newsletter recipient does not match the requested token context' using errcode = '42501'; end if;
  insert into private.crm_client_unsubscribe_tokens (
    token_hash, tenant_id, client_id, bulk_send_id, recipient_id, expires_at
  ) values (
    encode(digest(v_token, 'sha256'), 'hex'), p_tenant_id, p_client_id, p_bulk_send_id, p_recipient_id, now() + interval '2 years'
  )
  on conflict (recipient_id) do update
  set expires_at = greatest(private.crm_client_unsubscribe_tokens.expires_at, excluded.expires_at), updated_at = now();
  return v_token;
end;
$$;
revoke all on function public.crm_issue_client_unsubscribe_token(uuid, uuid, uuid, uuid) from public;
grant execute on function public.crm_issue_client_unsubscribe_token(uuid, uuid, uuid, uuid) to service_role;
