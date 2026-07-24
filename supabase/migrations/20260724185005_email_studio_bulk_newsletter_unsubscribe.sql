-- Email Studio Pass 9: replay-safe unsubscribe through the canonical client state engine.

create or replace function public.crm_process_client_unsubscribe(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_token private.crm_client_unsubscribe_tokens%rowtype;
  v_prior public.client_contact_policy_enum;
begin
  if nullif(btrim(p_token), '') is null then
    return jsonb_build_object('outcome', 'invalid_token');
  end if;

  select * into v_token
  from private.crm_client_unsubscribe_tokens token
  where token.token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex');

  if not found then return jsonb_build_object('outcome', 'invalid_token'); end if;
  if v_token.expires_at < now() then return jsonb_build_object('outcome', 'expired_token'); end if;

  select client.contact_policy into v_prior
  from public.clients client
  where client.id = v_token.client_id and client.tenant_id = v_token.tenant_id;

  if not found then return jsonb_build_object('outcome', 'invalid_token'); end if;

  if v_prior <> 'do_not_contact' then
    perform public.set_client_contact_policy(
      v_token.client_id,
      'do_not_contact'::public.client_contact_policy_enum,
      'inbound_remove_webhook',
      'Newsletter unsubscribe',
      null,
      false
    );
  end if;

  update private.crm_client_unsubscribe_tokens
  set used_at = coalesce(used_at, now()), updated_at = now()
  where id = v_token.id;

  return jsonb_build_object(
    'outcome', case when v_prior = 'do_not_contact' then 'already_unsubscribed' else 'unsubscribed' end
  );
end;
$$;
revoke all on function public.crm_process_client_unsubscribe(text) from public;
grant execute on function public.crm_process_client_unsubscribe(text) to service_role;
